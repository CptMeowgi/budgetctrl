// One place that answers every question about budget periods: which period
// a day belongs to, where a period starts and ends, its neighbours, its
// label, the days in it. The rest of the app asks a calendar instead of
// passing the payday day around, so a new kind of period (weekly and
// fortnightly pay, 0.7) needs teaching here and nowhere else.
//
// For now every calendar is monthly and gives exactly the answers the
// functions in periods.js and schedule.js always have; it is built on them.

import { isRecurringDue, isoDay, itemDateInPeriod, newEntryDate, periodKeyFor, periodLabel, periodRange, recurringDateInPeriod } from "./periods.js";
import { addMonths, monthsBetween } from "./schedule.js";

// Periods running from payday `cutoffDay` to the day before it a month
// later, keyed by the month they start in ("2026-10").
export function monthlyCalendar(cutoffDay) {
  // As the app always has: a missing payday is the 1st.
  const cd = cutoffDay || 1;
  return Object.freeze({
    kind: "monthly",
    cutoffDay: cd,
    // Plain calendar months, so the words say "month", not "period".
    calendarMonths: cd <= 1,
    keyFor: (date) => periodKeyFor(date, cd),
    current: (today = new Date()) => periodKeyFor(today, cd),
    range: (key) => periodRange(key, cd),
    next: (key) => addMonths(key, 1),
    prev: (key) => addMonths(key, -1),
    shift: (key, n) => addMonths(key, n),
    between: (fromKey, toKey) => monthsBetween(fromKey, toKey),
    label: (key) => periodLabel(key, cd),
    // Every day of the period, by the calendar (never by adding 24 hours,
    // which a clock change turns into 23 or 25).
    days: (key) => {
      const { start } = periodRange(key, cd);
      const stop = isoDay(periodRange(addMonths(key, 1), cd).start);
      const out = [];
      for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); isoDay(d) !== stop;
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        out.push(isoDay(d));
      }
      return out;
    },
    dateOf: (dayOfMonth, key) => recurringDateInPeriod(dayOfMonth, key, cd),
    itemDate: (item, key) => itemDateInPeriod(item, key, cd),
    isDue: (item, key, today) => isRecurringDue(item, key, today, cd),
    newEntryDate: (key, today) => newEntryDate(key, cd, today),
  });
}

// The calendar a budget's periods follow.
export function calendarFor(data) {
  return monthlyCalendar(data?.cutoffDay);
}

// Library functions accept a calendar, or a payday number as shorthand for
// a monthly one (which is how the tests and older callers pass it).
export function asCalendar(calendarOrCutoff) {
  return calendarOrCutoff && typeof calendarOrCutoff.keyFor === "function"
    ? calendarOrCutoff
    : monthlyCalendar(calendarOrCutoff);
}
