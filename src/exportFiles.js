import { budgetToCsv } from "./lib/csv.js";
import { isoDay, recurringDateInPeriod } from "./lib/periods.js";

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

export function exportData(data) {
  downloadText(JSON.stringify(data, null, 2), `budget-ctrl-backup-${fileDate()}.json`, "application/json");
}

export function exportCsv(data) {
  const csv = budgetToCsv(data, {
    resolveRecurringDate: (day, period) => isoDay(recurringDateInPeriod(day, period, data.cutoffDay || 1)),
    locale: data.locale || navigator.language,
    currency: data.currency,
  });
  downloadText(csv, `budget-ctrl-${fileDate()}.csv`, "text/csv;charset=utf-8");
}
