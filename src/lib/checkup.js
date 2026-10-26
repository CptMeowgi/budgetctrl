// The check-up: anything in the budget that looks wrong, each finding with
// the entry it's about, so the reader can open it and put it right. It reads
// and never writes. Findings, most important first:
//
//   missingCategory  filed under a category that no longer exists, so no
//                    budget counts it
//   duplicate        the same date, amount and name as another entry: often
//                    a statement imported twice, or typed in by hand as well
//   unpaidPast       a one-off payment in a past period never marked paid
//   rolloverDeficit  a rollover budget that arrives at this period empty or
//                    worse, carrying more overspending than a whole budget
//   uncategorized    spending with no category

import { calendarFor } from "./calendar.js";
import { capAt, carryInto } from "./envelopes.js";
import { fold } from "./search.js";
import { isSplit } from "./splits.js";
import { isoDay } from "./periods.js";
import { UNCATEGORIZED_NAME } from "./totals.js";

const ORDER = ["missingCategory", "duplicate", "unpaidPast", "rolloverDeficit", "uncategorized"];
const sameName = (s) => fold(s).replace(/\s+/g, " ").trim();
const cents = (n) => Math.round((Number(n) || 0) * 100);

export function checkUp(data, today = new Date()) {
  const cal = calendarFor(data);
  const curKey = cal.current(today);
  const spend = new Set((data.categories || []).map((c) => c.name));
  const money = new Set((data.creditCategories || []).map((c) => c.name));
  const out = [];
  const add = (type, f) => out.push({ type, ...f });

  // Spending's categories: a split names one for each part.
  const spendingCategories = (e) => (isSplit(e) ? e.splits.map((p) => p.category) : [e.category]);
  const checkSpending = (kind, entry, periodKey) => {
    const cats = spendingCategories(entry);
    const missing = [...new Set(cats.filter((c) => c && c !== UNCATEGORIZED_NAME && !spend.has(c)))];
    for (const category of missing) add("missingCategory", { kind, entry, periodKey, category });
    if (cats.some((c) => !c || c === UNCATEGORIZED_NAME)) add("uncategorized", { kind, entry, periodKey });
  };
  const checkMoneyIn = (kind, entry, periodKey) => {
    if (entry.category && !money.has(entry.category)) add("missingCategory", { kind, entry, periodKey, category: entry.category });
  };

  for (const t of data.recurringTemplate || []) checkSpending("recurringTemplate", t, null);
  for (const t of data.creditTemplate || []) checkMoneyIn("creditTemplate", t, null);
  const bills = new Set((data.recurringTemplate || []).map((t) => t.id));
  const credits = new Set((data.creditTemplate || []).map((t) => t.id));

  for (const periodKey of Object.keys(data.months || {}).sort()) {
    const m = data.months[periodKey];
    for (const e of m.expenses || []) checkSpending("expense", e, periodKey);
    // A bill's copy is checked through its template; one whose template is
    // gone (deleted, or from before templates had ids) is checked here.
    for (const r of m.recurring || []) if (!bills.has(r.templateId)) checkSpending("recurring", r, periodKey);
    for (const u of m.upcoming || []) {
      if (u.category && u.category !== UNCATEGORIZED_NAME && !spend.has(u.category)) add("missingCategory", { kind: "upcoming", entry: u, periodKey, category: u.category });
      // Settled means ticked paid, or a payment that pays itself.
      // Past means its due date has gone by, too: one filed early isn't late.
      const overdue = periodKey < curKey && (!u.dueDate || u.dueDate < isoDay(today));
      if (overdue && !u.paid && !u.autoPay) add("unpaidPast", { kind: "upcoming", entry: u, periodKey });
    }
    for (const c of m.credits || []) if (!credits.has(c.templateId)) checkMoneyIn("credit", c, periodKey);

    // Two identical rows from statements are taken as two payments: a
    // statement lists each one, and imports already skip what's entered.
    for (const [kind, list] of [["expense", m.expenses], ["credit", m.credits]]) {
      const seen = new Map();
      for (const e of list || []) {
        if (!e.date) continue;
        const key = `${e.date}|${cents(e.amount)}|${sameName(e.name)}`;
        const earlier = seen.get(key) || [];
        const of = earlier.find((o) => !(o.imported && e.imported));
        if (of) add("duplicate", { kind, entry: e, periodKey, of });
        seen.set(key, [...earlier, e]);
      }
    }
  }

  for (const c of data.categories || []) {
    if (!c.rollover) continue;
    const cap = capAt(c, curKey);
    if (cap == null || !(cap > 0)) continue;
    const carry = carryInto(data, c, curKey, today);
    if (carry <= -cap) add("rolloverDeficit", { kind: "category", entry: c, periodKey: curKey, carry, cap });
  }

  // Stable within a type: templates first, then periods oldest first.
  return ORDER.flatMap((type) => out.filter((f) => f.type === type));
}

// The fix a finding offers when there's only one sensible one: a duplicate
// is deleted, a past payment marked paid. The budget is returned changed in
// that one place; anything else is returned as it was.
export function fixFinding(data, finding) {
  const { type, kind, entry, periodKey } = finding;
  const m = data.months?.[periodKey];
  if (!m) return data;
  if (type === "duplicate") {
    const list = kind === "credit" ? "credits" : "expenses";
    return { ...data, months: { ...data.months, [periodKey]: { ...m, [list]: (m[list] || []).filter((x) => x.id !== entry.id) } } };
  }
  if (type === "unpaidPast") {
    return { ...data, months: { ...data.months, [periodKey]: { ...m, upcoming: (m.upcoming || []).map((u) => (u.id === entry.id ? { ...u, paid: true } : u)) } } };
  }
  return data;
}
