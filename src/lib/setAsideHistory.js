// The savings set-aside, remembered by date. It is kept per month, but what
// it was in an earlier period must not change when it is edited today: the
// carry is worked out from history, and a closed period's leftover depends on
// what was set aside then. Read the way a category's capHistory is.
//
//   savingsGoal.monthly   the amount as it is now
//   savingsGoal.history   [{ from: periodKey, monthly }]: what it was from when

import { EARLIEST } from "./envelopes.js";
import { calendarFor } from "./calendar.js";
import { perMonthOf, perPeriodOf } from "./setAside.js";

const byFrom = (a, b) => (a.from < b.from ? -1 : 1);

// The monthly set-aside that applied in a period. A period can override it
// for itself (month.setAside, stored per period as it was entered).
export function setAsideAt(data, periodKey) {
  const override = data.months?.[periodKey]?.setAside;
  if (override != null) return perMonthOf(override, calendarFor(data), periodKey);
  const g = data.savingsGoal;
  let value = Number(g?.monthly) || 0;
  if (!g?.history?.length) return value;
  for (const h of [...g.history].sort(byFrom)) {
    if (h.from <= periodKey) value = Number(h.monthly) || 0;
  }
  return value;
}

// The set-aside a period actually sets aside, in that period's own money. An
// override is read as it was entered: going through the monthly figure and
// back would round a fortnight's cents away, and what was typed on the Savings
// tab must be what the period used.
export function setAsidePerPeriod(data, periodKey) {
  const override = data.months?.[periodKey]?.setAside;
  if (override != null) return Number(override) || 0;
  return perPeriodOf(setAsideAt(data, periodKey), calendarFor(data), periodKey);
}

// Set the amount from `periodKey` on. The first change records the old amount
// as having applied to everything before. Typing several digits in one period
// replaces that period's entry instead of adding one per keystroke.
export function withSetAside(savingsGoal, monthly, periodKey) {
  let history = savingsGoal.history?.length
    ? [...savingsGoal.history]
    : [{ from: EARLIEST, monthly: Number(savingsGoal.monthly) || 0 }];
  history = history.filter((h) => h.from !== periodKey);
  history.push({ from: periodKey, monthly });
  history.sort(byFrom);
  return { ...savingsGoal, monthly, history };
}
