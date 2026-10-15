// Recurring bills and credits come in two kinds. Monthly ones fall on a day
// of the month (`dayOfMonth`, and optionally every N months from `anchor`).
// Weekly ones fall every week or two from a first date:
//   { repeat: "weeks", every: 1 | 2, startDate: "YYYY-MM-DD" }
// A period holds one copy of a weekly item for each date it falls on, and
// each copy stores that `date`.

import { datesOnDay, daysBetween, isoDay, monthKey, parseDay } from "./periods.js";
import { isOnCycle, nextOnCycle } from "./schedule.js";

export function isWeekly(item) {
  return item?.repeat === "weeks";
}

// A copy that came from a recurring template (monthly or weekly), as
// opposed to a one-off entry.
export function isRecurringItem(item) {
  return item?.dayOfMonth != null || isWeekly(item);
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// The dates a weekly item falls on from `start` to `end`, both included,
// stepping `every` weeks from its first date. Built from year, month and
// day, so a clock change can't move one.
export function weeklyDates(item, start, end) {
  const first = parseDay(item?.startDate);
  if (!item?.startDate || isNaN(first.getTime())) return [];
  const step = 7 * (Number(item.every) === 2 ? 2 : 1);
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const to = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  let k = first >= from ? 0 : Math.ceil(daysBetween(first, from) / step);
  const out = [];
  for (let d = addDays(first, k * step); d <= to; d = addDays(first, ++k * step)) out.push(d);
  return out;
}

// The dates a monthly item falls on from `start` to `end`: its day of each
// month (the month's last day, when shorter), in the months on its cycle.
export function monthlyDates(item, start, end) {
  return datesOnDay(item?.dayOfMonth, start, end).filter((d) => isOnCycle(item, monthKey(d)));
}

// A period's copies carry their date when the day of the month can't say it:
// a weekly item's, and every copy in a fortnight.
const datedIn = (tpl, cal, periodKey) => isWeekly(tpl) || cal.kindOf(periodKey) === "weeks";

// The copies a period gets of a template: one per date it falls on there.
// In a monthly period a monthly item's copy stays undated, exactly as before.
export function copiesFor(tpl, cal, periodKey, newId) {
  const dated = datedIn(tpl, cal, periodKey);
  return cal.occurrences(tpl, periodKey).map((d) => (dated
    ? { ...tpl, id: newId(), templateId: tpl.id, date: isoDay(d) }
    : { ...tpl, id: newId(), templateId: tpl.id }));
}

// The copies a period should hold of a template but doesn't. An undated one
// is missing when the period has no copy of it at all. Dated ones are
// missing a copy for each date nothing stands on, so a period left with some
// of them (after the payday changed, say) is topped up, not doubled.
export function missingCopies(tpl, cal, periodKey, items, newId) {
  const mine = (items || []).filter((x) => x.templateId === tpl.id);
  if (!datedIn(tpl, cal, periodKey)) return mine.length ? [] : copiesFor(tpl, cal, periodKey, newId);
  const have = new Set(mine.map((x) => x.date));
  return copiesFor(tpl, cal, periodKey, newId).filter((c) => !have.has(c.date));
}

export function occursIn(tpl, cal, periodKey) {
  return cal.occurrences(tpl, periodKey).length > 0;
}

// The first period, from `fromKey` on, that an item falls in.
export function nextPeriodOf(tpl, cal, fromKey) {
  if (!isWeekly(tpl)) {
    if (!cal.scheduled) return nextOnCycle(tpl, fromKey);
    // A budget that switched: the first period ahead the bill falls in.
    let k = fromKey;
    for (let i = 0; i < 400; i++, k = cal.next(k)) if (occursIn(tpl, cal, k)) return k;
    return fromKey;
  }
  const { start } = cal.range(fromKey);
  const first = parseDay(tpl.startDate);
  const next = first >= start ? first : weeklyDates(tpl, start, addDays(start, 14))[0];
  return next ? cal.keyFor(next) : fromKey;
}
