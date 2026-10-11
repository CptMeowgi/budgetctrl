// Search across every period and every kind of entry. The tabs only ever show
// the current period, so "what did I spend at Orlen this year" had no answer.

import { recurringDateInPeriod, isoDay } from "./periods.js";
import { splitParts } from "./splits.js";

export const ENTRY_KINDS = ["expense", "recurring", "upcoming", "credit"];

// Lower case without accents, so "zabka" finds "Żabka" and "oplata" finds
// "Opłata". Ł has no decomposed form, so it is mapped by hand.
export function fold(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l");
}

// A token that reads as an amount: "120", "120,50", "1 240.00".
function asAmount(token) {
  const t = token.replace(/\s/g, "").replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : null;
}

// Every entry in the budget, flattened, each with the date it falls on.
export function allEntries(data) {
  const cutoffDay = data.cutoffDay || 1;
  const out = [];
  for (const [periodKey, m] of Object.entries(data.months || {})) {
    for (const e of m.expenses || []) {
      out.push({ kind: "expense", entry: e, periodKey, date: e.date || "", amount: e.amount || 0, category: e.category,
        categories: splitParts(e).map((p) => p.category) });
    }
    for (const r of m.recurring || []) {
      out.push({ kind: "recurring", entry: r, periodKey, amount: r.amount || 0, category: r.category,
        date: isoDay(recurringDateInPeriod(r.dayOfMonth, periodKey, cutoffDay)) });
    }
    for (const u of m.upcoming || []) out.push({ kind: "upcoming", entry: u, periodKey, date: u.dueDate || "", amount: u.amount || 0, category: u.category });
    for (const c of m.credits || []) {
      const date = c.dayOfMonth != null ? isoDay(recurringDateInPeriod(c.dayOfMonth, periodKey, cutoffDay)) : (c.date || "");
      out.push({ kind: "credit", entry: c, periodKey, date, amount: c.amount || 0, category: c.category || c.source });
    }
  }
  return out;
}

// query: { text, kinds, category, from, to, min, max } - every part optional.
// Text words must all match, each in the name, category or note - or, for a
// number, the amount itself. `label` gives a category's name as shown, so a
// built-in category is found in the reader's language as well as by its key.
export function matches(item, query, label = (c) => c) {
  const q = query || {};
  if (q.kinds && q.kinds.length && !q.kinds.includes(item.kind)) return false;
  if (q.category && !(item.categories || [item.category || ""]).includes(q.category)) return false;
  if (q.from && item.date < q.from) return false;
  if (q.to && item.date > q.to) return false;
  if (q.min != null && q.min !== "" && item.amount < Number(q.min)) return false;
  if (q.max != null && q.max !== "" && item.amount > Number(q.max)) return false;
  const words = fold(q.text).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const cats = (item.categories || [item.category]).filter(Boolean);
  const hay = fold([item.entry.name, ...cats, ...cats.map(label), item.entry.note].filter(Boolean).join(" "));
  return words.every((w) => {
    if (hay.includes(w)) return true;
    const n = asAmount(w);
    return n != null && Math.abs(item.amount - n) < 0.005;
  });
}

export function search(data, query, label) {
  const results = allEntries(data)
    .filter((it) => matches(it, query, label))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.amount - a.amount)));
  let spent = 0;
  let received = 0;
  for (const r of results) {
    if (r.kind === "credit") received += r.amount;
    else spent += r.amount;
  }
  return { results, count: results.length, spent, received };
}

// Is the query asking for anything at all? An empty search lists nothing
// rather than every entry ever made.
export function isEmptyQuery(q) {
  return !q || (!fold(q.text).trim() && !(q.kinds && q.kinds.length) && !q.category && !q.from && !q.to
    && (q.min == null || q.min === "") && (q.max == null || q.max === ""));
}
