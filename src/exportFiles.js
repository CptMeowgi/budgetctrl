import { budgetToCsv } from "./lib/csv.js";
import { isoDay } from "./lib/periods.js";
import { calendarFor } from "./lib/calendar.js";

export function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Local calendar date for filenames. toISOString() is UTC, so an export made
// just after midnight anywhere east of Greenwich was stamped with yesterday.
export function fileDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
const isObject = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const notShare = (list) => (Array.isArray(list) ? list.filter((e) => !e?.fromHousehold) : list);
const LISTS = ["expenses", "recurring", "upcoming", "credits"];
const periodWithoutShares = (m) => ({ ...m, ...Object.fromEntries(LISTS.filter((k) => k in m).map((k) => [k, notShare(m[k])])) });

// What a backup file holds: the budget, and nothing that only lives in
// memory. The store's stamp (budgetOf, budgetGen) says which budget a doc is
// and when it was handed out; a share (fromHousehold) is read from the
// household each time an own budget opens. None of it is ever written.
export function exportable(data) {
  const out = without(data, ["budgetOf", "budgetGen"]);
  if (isObject(out.months)) {
    out.months = Object.fromEntries(Object.entries(out.months).map(([k, m]) => [k, isObject(m) ? periodWithoutShares(m) : m]));
  }
  for (const k of ["recurringTemplate", "creditTemplate"]) if (k in out) out[k] = notShare(out[k]);
  return out;
}

export function exportData(data) {
  downloadText(JSON.stringify(exportable(data), null, 2), `budget-ctrl-backup-${fileDate()}.json`, "application/json");
}

// A budget read from a file never says whose it was in memory, and never
// holds an own budget (`own`). One brought in from a file (`imported`), which
// may come from another computer, doesn't say who has an own budget either
// (`hasOwn`): the store marks whoever has one on this computer. A backup this
// computer took keeps its marks.
export function budgetFromFile(parsed, { imported = false } = {}) {
  const doc = without(parsed, ["budgetOf", "budgetGen", "own"]);
  if (imported && Array.isArray(doc.people)) doc.people = doc.people.map((p) => (isObject(p) ? without(p, ["hasOwn"]) : p));
  return doc;
}

export function exportCsv(data) {
  const cal = calendarFor(data);
  const csv = budgetToCsv(data, {
    // Each recurring copy on the date every screen shows for it.
    resolveItemDate: (item, period) => isoDay(cal.itemDate(item, period)),
    locale: data.locale || navigator.language,
    currency: data.currency,
  });
  downloadText(csv, `budget-ctrl-${fileDate()}.csv`, "text/csv;charset=utf-8");
}
