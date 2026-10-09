// CSV export of every entry across every period, for spreadsheets and tax time.
//
// Two details decide whether the file opens cleanly:
//
// 1. Spreadsheets pick the column separator from the system locale. Where the
//    decimal mark is a comma (Poland, Germany, most of Europe), Excel expects
//    ";" between columns - a "," file opens as one column. So the dialect is
//    derived from the same number-format setting the app displays with.
// 2. Excel assumes the system codepage unless a UTF-8 byte order mark is
//    present, which mangles "ł", "ż" and friends. The BOM is on by default.

export const CSV_COLUMNS = ["Period", "Date", "Type", "Name", "Category", "Amount", "Currency", "Status", "Note"];

// The decimal mark the locale uses, and the column separator that goes with it.
export function csvDialect(locale) {
  let decimal = ".";
  try {
    const parts = new Intl.NumberFormat(locale || undefined).formatToParts(1.5);
    decimal = parts.find((p) => p.type === "decimal")?.value || ".";
  } catch { /* unknown locale: fall back to the standard dialect */ }
  return decimal === "," ? { delimiter: ";", decimal: "," } : { delimiter: ",", decimal: "." };
}

// Quote a field only when it has to be: it contains the delimiter, a quote, a
// line break, or leading/trailing whitespace that would otherwise be trimmed.
export function csvEscape(value, delimiter = ",") {
  const s = value == null ? "" : String(value);
  const needsQuotes = s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s);
  return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s;
}

// A text cell that starts with = + - or @ is evaluated as a formula when the
// file is opened in Excel or Sheets ("CSV injection"). Names and notes are free
// text, so they are neutralised with a leading apostrophe. Amounts are not -
// a negative amount has to stay a number.
export function guardText(s) {
  return /^[=+\-@\t\r]/.test(s || "") ? `'${s}` : (s || "");
}

export function formatAmount(n, decimal) {
  const fixed = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
  return decimal === "," ? fixed.replace(".", ",") : fixed;
}

// One row per recorded entry. Spending is negative and money in is positive, so
// a plain SUM over the Amount column gives the net figure without any formula.
//
// resolveRecurringDate(dayOfMonth, periodKey) is injected because the period
// arithmetic (custom cutoff days, short months) lives with the app; this module
// only formats.
export function budgetToRows(data, { resolveRecurringDate, currency }) {
  const rows = [];
  const cur = currency || data.currency || "";
  for (const [period, m] of Object.entries(data.months || {})) {
    for (const e of m.expenses || []) {
      rows.push({ period, date: e.date || "", type: "Expense", name: e.name, category: e.category,
                  amount: -(e.amount || 0), status: "", note: e.note });
    }
    for (const r of m.recurring || []) {
      rows.push({ period, date: resolveRecurringDate ? resolveRecurringDate(r.dayOfMonth, period) : "",
                  type: "Recurring", name: r.name, category: r.category, amount: -(r.amount || 0),
                  status: r.autoPay ? "Pays itself" : "", note: r.note });
    }
    for (const u of m.upcoming || []) {
      rows.push({ period, date: u.dueDate || "", type: "Upcoming", name: u.name, category: u.category,
                  amount: -(u.amount || 0), status: u.paid ? "Paid" : u.autoPay ? "Pays itself" : "Pending",
                  note: u.note });
    }
    for (const c of m.credits || []) {
      const recurring = c.dayOfMonth != null;
      rows.push({ period, date: recurring ? (resolveRecurringDate ? resolveRecurringDate(c.dayOfMonth, period) : "") : (c.date || ""),
                  type: recurring ? "Recurring credit" : "Credit", name: c.name, category: c.category || c.source,
                  amount: c.amount || 0, status: "", note: c.note });
    }
  }
  rows.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.period.localeCompare(b.period));
  return rows.map((r) => ({ ...r, currency: cur }));
}

export function rowsToCsv(rows, { delimiter = ",", decimal = ".", bom = true } = {}) {
  const line = (cells) => cells.map((c) => csvEscape(c, delimiter)).join(delimiter);
  const body = rows.map((r) => line([
    r.period, r.date, r.type, guardText(r.name), guardText(r.category),
    formatAmount(r.amount, decimal), r.currency, r.status, guardText(r.note),
  ]));
  // CRLF is what the CSV spec and Excel both expect.
  return (bom ? "\uFEFF" : "") + [line(CSV_COLUMNS), ...body].join("\r\n") + "\r\n";
}

export function budgetToCsv(data, { resolveRecurringDate, locale, currency, bom = true } = {}) {
  const dialect = csvDialect(locale);
  return rowsToCsv(budgetToRows(data, { resolveRecurringDate, currency }), { ...dialect, bom });
}
