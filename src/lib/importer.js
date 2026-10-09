// Importing bank statements (CSV).
//
// Bank exports have no common format. Polish banks in particular tend to write
// Windows-1250 rather than UTF-8, separate columns with ";", use decimal commas,
// and put a block of account metadata above the transaction table. So nothing
// here assumes a layout: encoding, separator, header row, date order and column
// meanings are all detected, and the UI lets the user correct the column guess.
//
// The harder problem is not parsing but double counting. A statement contains
// the rent standing order (already a recurring bill), the salary (already the
// period's income), and purchases the user may have typed in by hand. Imported
// blindly, every one of those would be counted twice. analyzeImport() matches
// each transaction against what the budget already holds and proposes an action,
// leaving anything it believes is already counted unticked.

import { periodKeyFor, recurringDateInPeriod, daysBetween, isoDay } from "./periods.js";

// ---------------------------------------------------------------- decoding

// UTF-8 if the bytes are valid UTF-8, otherwise Windows-1250 - the codepage
// Polish banks commonly export in. A wrong guess would turn "Żabka" into
// mojibake in every imported name.
export function decodeBytes(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text;
  let encoding = "utf-8";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    encoding = "windows-1250";
    text = new TextDecoder("windows-1250").decode(buf);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, encoding };
}

// ------------------------------------------------------------------- parsing

// RFC 4180: quoted fields may contain the delimiter, doubled quotes, and line
// breaks. Splitting on lines first would break any description with a newline.
export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

// The delimiter that splits the most lines into the same number of fields.
export function sniffDelimiter(text) {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 60).join("\n");
  let best = { delimiter: ";", score: -1 };
  for (const d of [";", ",", "\t", "|"]) {
    const rows = parseCsv(sample, d);
    const counts = new Map();
    for (const r of rows) if (r.length > 1) counts.set(r.length, (counts.get(r.length) || 0) + 1);
    let modeCount = 0;
    let modeWidth = 0;
    for (const [w, c] of counts) if (c > modeCount || (c === modeCount && w > modeWidth)) { modeCount = c; modeWidth = w; }
    const score = modeCount * Math.min(modeWidth, 8);
    if (score > best.score) best = { delimiter: d, score };
  }
  return best.delimiter;
}

// ---------------------------------------------------------- values in cells

// "-1 234,56", "1.234,56", "1,234.56", "(12.50)", "12,50 PLN", "123,45-"
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/[\u00a0\u202f\s]/g, "").replace(/[A-Za-zżźćńółęąśŻŹĆĄŚĘŁÓŃ$€£zł]/g, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { negative = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: whichever comes last is the decimal mark.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, ""); // "1.234.567" can only be thousands
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function validYMD(y, m, d) {
  if (!(m >= 1 && m <= 12)) return null;
  const dim = new Date(y, m, 0).getDate();
  if (!(d >= 1 && d <= dim)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Whether a column of dates is day-first or month-first. Any value whose first
// part exceeds 12 settles it; with no such evidence, day-first, since that is
// what European banks use.
export function detectDateOrder(values) {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const v of values) {
    const s = String(v || "").trim();
    if (/^\d{4}[-./]/.test(s)) return "YMD";
    const m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
    if (!m) continue;
    if (+m[1] > 12) dayFirst++;
    if (+m[2] > 12) monthFirst++;
  }
  return monthFirst > dayFirst ? "MDY" : "DMY";
}

export function parseDate(raw, order = "DMY") {
  const s = String(raw || "").trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);
  if (m) return order === "MDY" ? validYMD(+m[3], +m[1], +m[2]) : validYMD(+m[3], +m[2], +m[1]);
  return null;
}

// ------------------------------------------------------------ table layout

export function normalizeHeader(h) {
  return String(h || "")
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Statements often start with account details, balances and a date range. The
// transaction table is the widest consistent block; its header is the first row
// of that width that reads as labels rather than values.
export function findHeaderRow(rows) {
  const widths = new Map();
  for (const r of rows) if (r.length >= 3) widths.set(r.length, (widths.get(r.length) || 0) + 1);
  let width = 0;
  let best = 0;
  for (const [w, c] of widths) if (c > best || (c === best && w > width)) { best = c; width = w; }
  const looksLikeValue = (c) => parseAmount(c) != null || parseDate(c) != null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < width) continue;
    const labels = r.filter((c) => c && !looksLikeValue(c)).length;
    if (labels >= Math.ceil(width / 2)) return i;
  }
  return 0;
}

const KEYWORDS = {
  date: ["data operacji", "data transakcji", "data ksiegowania", "transaction date", "booking date", "value date", "data", "date"],
  payee: ["kontrahent", "odbiorca", "nadawca", "nazwa odbiorcy", "nazwa nadawcy", "payee", "merchant", "counterparty", "beneficiary"],
  title: ["tytul", "opis operacji", "opis", "description", "details", "title", "reference", "memo"],
  amount: ["kwota operacji", "kwota transakcji", "kwota", "amount", "wartosc", "value"],
  debit: ["obciazenia", "obciazenie", "wydatki", "debit", "money out", "withdrawal", "paid out"],
  credit: ["uznania", "uznanie", "wplywy", "credit", "money in", "deposit", "paid in"],
};

// Best guess at which column is which, by header text. Every value is an index
// into the header or -1. Payee and title are kept apart because banks usually
// split them: the payee makes a good entry name, the title a good note.
export function guessMapping(header) {
  const norm = header.map(normalizeHeader);
  const used = new Set();
  const pick = (keys) => {
    for (const k of keys) {
      const i = norm.findIndex((h, idx) => !used.has(idx) && (h === k || h.startsWith(k + " ") || h.includes(k)));
      if (i >= 0) { used.add(i); return i; }
    }
    return -1;
  };
  const date = pick(KEYWORDS.date);
  const debit = pick(KEYWORDS.debit);
  const credit = pick(KEYWORDS.credit);
  const amount = debit >= 0 && credit >= 0 ? -1 : pick(KEYWORDS.amount);
  const payee = pick(KEYWORDS.payee);
  const title = pick(KEYWORDS.title);
  return { date, payee, title, amount, debit, credit };
}

// Rows -> transactions with an ISO date, a name, a note and a signed amount
// (money out negative). Rows without a usable date or amount are skipped and
// counted rather than guessed at.
export function toTransactions(rows, headerIndex, mapping, { invert = false } = {}) {
  const body = rows.slice(headerIndex + 1);
  const order = detectDateOrder(body.map((r) => r[mapping.date]));
  const out = [];
  let skipped = 0;
  for (const r of body) {
    const date = parseDate(r[mapping.date], order);
    let amount = null;
    if (mapping.amount >= 0) {
      amount = parseAmount(r[mapping.amount]);
    } else if (mapping.debit >= 0 || mapping.credit >= 0) {
      const out_ = mapping.debit >= 0 ? parseAmount(r[mapping.debit]) : null;
      const in_ = mapping.credit >= 0 ? parseAmount(r[mapping.credit]) : null;
      if (out_) amount = -Math.abs(out_);
      else if (in_) amount = Math.abs(in_);
    }
    if (!date || amount == null || amount === 0) { skipped++; continue; }
    if (invert) amount = -amount;
    const payee = mapping.payee >= 0 ? (r[mapping.payee] || "").trim() : "";
    const title = mapping.title >= 0 ? (r[mapping.title] || "").trim() : "";
    const name = (payee || title || "Imported transaction").replace(/\s+/g, " ").slice(0, 80);
    const note = payee && title && title !== payee ? title.replace(/\s+/g, " ").slice(0, 200) : undefined;
    out.push({ date, name, note, amount: Math.round(amount * 100) / 100 });
  }
  return { transactions: out, skipped, dateOrder: order };
}

// --------------------------------------------------------------- analysis

function normName(s) {
  return String(s || "")
    .toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[0-9]/g, " ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}

const sameMoney = (a, b) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;
const dayGap = (isoA, isoB) => Math.abs(daysBetween(new Date(isoA + "T00:00:00"), new Date(isoB + "T00:00:00")));

// Learn categories from what the user has already filed: an expense named
// "Biedronka" in Food means an imported "BIEDRONKA 4521 KRAKOW" is probably Food.
function categoryIndex(data) {
  const exact = new Map();
  const first = new Map();
  const periods = Object.keys(data.months || {}).sort();
  for (const k of periods) {
    for (const e of data.months[k].expenses || []) {
      if (!e.category || e.category === "Uncategorized") continue;
      const n = normName(e.name);
      if (!n) continue;
      exact.set(n, e.category);
      const w = n.split(" ").find((x) => x.length >= 3);
      if (w) first.set(w, e.category);
    }
  }
  return { exact, first };
}

function suggestCategory(name, index) {
  const n = normName(name);
  if (index.exact.has(n)) return index.exact.get(n);
  for (const w of n.split(" ")) if (w.length >= 3 && index.first.has(w)) return index.first.get(w);
  return undefined;
}

// Decide, for each transaction, what importing it should do:
//   expense  - money out, new
//   credit   - money in, new
//   markPaid - money out that settles an unpaid Upcoming payment
//   skip     - already counted (duplicate, a recurring bill, the salary)
// `include` is the proposed default; the user can override every row.
export function analyzeImport(transactions, data) {
  const cutoffDay = data.cutoffDay || 1;
  const index = categoryIndex(data);

  // Existing entries each absorb at most one transaction, so two identical
  // coffees on the same day are not both waved through as one duplicate.
  const claimed = new Set();
  const claim = (key) => { if (claimed.has(key)) return false; claimed.add(key); return true; };

  return transactions.map((tx, i) => {
    const period = periodKeyFor(new Date(tx.date + "T00:00:00"), cutoffDay);
    const m = (data.months || {})[period];
    const base = { ...tx, id: `tx-${i}`, period };

    if (tx.amount < 0) {
      for (const e of m?.expenses || []) {
        if (e.date === tx.date && sameMoney(e.amount, tx.amount) && claim(`e:${e.id}`)) {
          return { ...base, action: "skip", include: false, reason: `Already entered as "${e.name}"` };
        }
      }
      for (const r of m?.recurring || []) {
        if (r.dayOfMonth == null || !sameMoney(r.amount, tx.amount)) continue;
        const due = isoDay(recurringDateInPeriod(r.dayOfMonth, period, cutoffDay));
        if (dayGap(due, tx.date) <= 5 && claim(`r:${r.id}`)) {
          return { ...base, action: "skip", include: false, reason: `Matches your recurring "${r.name}"` };
        }
      }
      for (const [pk, pm] of Object.entries(data.months || {})) {
        for (const u of pm.upcoming || []) {
          if (!sameMoney(u.amount, tx.amount) || !u.dueDate) continue;
          if (dayGap(u.dueDate, tx.date) > 10 || !claim(`u:${u.id}`)) continue;
          // Already paid means an earlier import (or the user) recorded this
          // payment by ticking the bill rather than adding an expense, so an
          // overlapping statement must not add it a second time.
          if (u.paid) {
            return { ...base, action: "skip", include: false, reason: `Already paid: "${u.name}"` };
          }
          return { ...base, action: "markPaid", include: true, target: { period: pk, id: u.id },
                   reason: `Pays your upcoming "${u.name}" — will mark it paid` };
        }
      }
      return { ...base, action: "expense", include: true, category: suggestCategory(tx.name, index) };
    }

    for (const c of m?.credits || []) {
      const cDate = c.dayOfMonth != null ? isoDay(recurringDateInPeriod(c.dayOfMonth, period, cutoffDay)) : c.date;
      if (cDate && sameMoney(c.amount, tx.amount) && dayGap(cDate, tx.date) <= 5 && claim(`c:${c.id}`)) {
        return { ...base, action: "skip", include: false, reason: `Already recorded as credit "${c.name}"` };
      }
    }
    // Salary arrives as money in, but the budget already counts it as the
    // period's income. A match within 2% is treated as that salary.
    const income = m?.income || 0;
    if (income > 0 && Math.abs(tx.amount - income) <= Math.max(1, income * 0.02) && claim(`income:${period}`)) {
      return { ...base, action: "skip", include: false, reason: "Looks like your salary — already counted as income" };
    }
    return { ...base, action: "credit", include: true };
  });
}

// Apply the rows the user kept. Pure; `newId` is injected so tests are stable.
// Transactions land in the period their date falls in, which may be a period
// the budget has never had - those are created empty rather than dropped.
export function applyImport(data, rows, newId) {
  const months = { ...(data.months || {}) };
  const ensure = (k) => {
    if (!months[k]) months[k] = { income: 0, expenses: [], recurring: [], upcoming: [], credits: [] };
    else months[k] = { ...months[k] };
    return months[k];
  };
  const counts = { expenses: 0, credits: 0, markedPaid: 0 };
  for (const r of rows) {
    if (!r.include) continue;
    if (r.action === "expense") {
      const m = ensure(r.period);
      m.expenses = [...(m.expenses || []), { id: newId(), name: r.name, amount: Math.abs(r.amount), date: r.date,
                                             category: r.category || "Uncategorized", note: r.note, imported: true }];
      counts.expenses++;
    } else if (r.action === "credit") {
      const m = ensure(r.period);
      m.credits = [...(m.credits || []), { id: newId(), name: r.name, amount: Math.abs(r.amount), date: r.date,
                                           category: r.category || "Other", note: r.note, imported: true }];
      counts.credits++;
    } else if (r.action === "markPaid" && r.target) {
      const m = ensure(r.target.period);
      m.upcoming = (m.upcoming || []).map((u) => (u.id === r.target.id ? { ...u, paid: true } : u));
      counts.markedPaid++;
    }
  }
  return { data: { ...data, months }, counts };
}
