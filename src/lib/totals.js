// What counts as spent, and as earned, in a budget period. The single definition
// every total, chart, category budget and report uses, so no two screens can
// disagree.
//
// Spending used to be computed independently in about ten places, and they did
// disagree: the Total Spent card counted paid Upcoming payments while the
// category breakdown, every category budget, the Year tab and History did not.
// A 300 paid dentist bill showed in Total Spent while its category read 0 spent
// against a 200 cap - over budget, displayed as untouched.
//
// As of `today`, a period's spending is:
//   - every expense recorded in it
//   - each recurring bill once its day has passed (all of them, once the period
//     has closed)
//   - each Upcoming payment once settled: ticked paid, or a self-paying bill
//     whose due date has passed
//
// Its income is the base income plus each credit once received: a repeating
// credit once its day has passed, a one-off once its date has.

import { isRecurringDue, isoDay } from "./periods.js";
import { upcomingSettled } from "./reminders.js";

export const UNCATEGORIZED_NAME = "Uncategorized";
export const OTHER_SOURCE_NAME = "Other";

export function periodSpending(month, periodKey, today, cutoffDay) {
  const byCategory = new Map();
  const add = (category, amount) => {
    const key = category || UNCATEGORIZED_NAME;
    byCategory.set(key, (byCategory.get(key) || 0) + (amount || 0));
  };
  // The entries that were counted, for anything that lists rather than sums.
  const items = [];
  let expenses = 0;
  let recurring = 0;
  let upcoming = 0;
  for (const e of month?.expenses || []) {
    expenses += e.amount || 0;
    add(e.category, e.amount);
    items.push({ kind: "expense", entry: e });
  }
  for (const r of month?.recurring || []) {
    if (!isRecurringDue(r, periodKey, today, cutoffDay)) continue;
    recurring += r.amount || 0;
    add(r.category, r.amount);
    items.push({ kind: "recurring", entry: r });
  }
  for (const u of month?.upcoming || []) {
    if (!upcomingSettled(u, today)) continue;
    upcoming += u.amount || 0;
    add(u.category, u.amount);
    items.push({ kind: "upcoming", entry: u });
  }
  return { total: expenses + recurring + upcoming, expenses, recurring, upcoming, byCategory, items };
}

export function creditReceived(c, periodKey, today, cutoffDay) {
  if (c.dayOfMonth != null) return isRecurringDue(c, periodKey, today, cutoffDay);
  return (c.date || "") <= isoDay(today);
}

export function periodIncome(month, periodKey, today, cutoffDay) {
  const base = month?.income || 0;
  const bySource = new Map();
  let credits = 0;
  let pending = 0;
  for (const c of month?.credits || []) {
    if (!creditReceived(c, periodKey, today, cutoffDay)) { pending += c.amount || 0; continue; }
    credits += c.amount || 0;
    const source = c.category || c.source || OTHER_SOURCE_NAME;
    bySource.set(source, (bySource.get(source) || 0) + (c.amount || 0));
  }
  return { total: base + credits, base, credits, pending, bySource };
}

// Average spending per period in one category, over periods strictly before
// `beforeKey` - "what you usually spend here", for comparing against now.
export function categoryAverage(data, category, beforeKey, today) {
  const cutoffDay = data.cutoffDay || 1;
  const keys = Object.keys(data.months || {}).filter((k) => k < beforeKey);
  if (!keys.length) return null;
  let total = 0;
  for (const k of keys) total += periodSpending(data.months[k], k, today, cutoffDay).byCategory.get(category) || 0;
  return total / keys.length;
}
