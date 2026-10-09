// Category budgets that roll over. A category set to roll over carries what
// was left of its budget into the next period - or what it overspent, as a
// deficit - the way an envelope of cash would. Groceries usually shouldn't;
// gifts, clothes or car repairs usually should, so it is chosen per category.
//
// Nothing is stored but the settings. The carry is recomputed from history
// every time, so editing a past period - History is fully editable - always
// shows up in the balance, and undo needs nothing special.
//
// A category's settings:
//   cap         the budget per period, as it is now
//   capHistory  [{ from: periodKey, cap }]: what the budget was from when, so
//               raising it today does not rewrite what earlier periods carried
//   rollover    { from: periodKey }: leftovers count from this period onward.
//               Switching rollover on never reaches back into older history.

import { periodSpending } from "./totals.js";

const EARLIEST = "0000-00";

// A budget of zero or less is no budget, as it always has been on screen.
const asBudget = (v) => (typeof v === "number" && v > 0 ? v : null);

// The budget that applied in a period. Categories from before budgets were
// remembered have no history: their one cap stands for every period.
export function capAt(category, periodKey) {
  const history = category?.capHistory;
  if (!history?.length) return asBudget(category?.cap);
  let cap = null;
  for (const h of [...history].sort((a, b) => (a.from < b.from ? -1 : 1))) {
    if (h.from <= periodKey) cap = asBudget(h.cap);
  }
  return cap;
}

// Set the budget from `periodKey` on. The first change also records the old
// budget as having applied to everything before, so history is never lost.
export function withCap(category, cap, periodKey) {
  const next = asBudget(cap);
  let history = category.capHistory?.length
    ? [...category.capHistory]
    : (asBudget(category.cap) != null ? [{ from: EARLIEST, cap: category.cap }] : []);
  history = history.filter((h) => h.from !== periodKey);
  history.push({ from: periodKey, cap: next });
  history.sort((a, b) => (a.from < b.from ? -1 : 1));
  const out = { ...category, capHistory: history };
  if (next == null) {
    delete out.cap;
    // Rolling over needs a budget to roll over.
    delete out.rollover;
  } else {
    out.cap = next;
  }
  return out;
}

// Turning rollover on starts counting from this period; leaving it on keeps
// the balance it has built up.
export function withRollover(category, on, periodKey) {
  if (!on || asBudget(category.cap) == null) {
    const out = { ...category };
    delete out.rollover;
    return out;
  }
  return category.rollover ? category : { ...category, rollover: { from: periodKey } };
}

// Wipe the carried balance and count afresh from this period.
export function startFresh(category, periodKey) {
  return category.rollover ? { ...category, rollover: { from: periodKey } } : category;
}

// What a category brings into `periodKey` from the periods before it: each
// earlier period's budget minus what was spent, since rollover began. Periods
// the app has no record of (it was not opened that month) add nothing - an
// untracked month is not a month of saving.
export function carryInto(data, category, periodKey, today) {
  if (!category?.rollover || asBudget(category.cap) == null) return 0;
  const cutoffDay = data.cutoffDay || 1;
  let carry = 0;
  for (const k of Object.keys(data.months || {}).sort()) {
    if (k < category.rollover.from || k >= periodKey) continue;
    const cap = capAt(category, k);
    if (cap == null) continue;
    const spent = periodSpending(data.months[k], k, today, cutoffDay).byCategory.get(category.name) || 0;
    carry += cap - spent;
  }
  return Math.round(carry * 100) / 100;
}

// Everything the budget card shows for one category in one period.
export function envelope(data, category, periodKey, today, spent) {
  const cap = capAt(category, periodKey);
  const carry = carryInto(data, category, periodKey, today);
  const available = cap == null ? null : cap + carry;
  return { cap, carry, available, spent, left: available == null ? null : available - spent };
}
