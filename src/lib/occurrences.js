// Recurring bills and credits come in two kinds. Monthly ones fall on a day
// of the month (`dayOfMonth`, and optionally every N months from `anchor`).
// Weekly ones fall every week or two from a first date:
//   { repeat: "weeks", every: 1 | 2, startDate: "YYYY-MM-DD" }
// A period holds one copy of a weekly item for each date it falls on, and
// each copy stores that `date`.

import { daysBetween, isoDay, parseDay } from "./periods.js";
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

// The copies a period gets of a template. A weekly item gets one per date
// it falls on, each dated. A monthly item gets one undated copy when the
// period is on its cycle, exactly as before.
export function copiesFor(tpl, cal, periodKey, newId) {
  if (isWeekly(tpl)) {
    const { start, end } = cal.range(periodKey);
    return weeklyDates(tpl, start, end).map((d) => ({ ...tpl, id: newId(), templateId: tpl.id, date: isoDay(d) }));
  }
  return isOnCycle(tpl, periodKey) ? [{ ...tpl, id: newId(), templateId: tpl.id }] : [];
}

// The copies a period should hold of a template but doesn't. A monthly item
// is missing when the period has no copy of it at all. A weekly one is
// missing a copy for each date nothing stands on, so a period left with some
// of its copies (after the payday changed, say) is topped up, not doubled.
export function missingCopies(tpl, cal, periodKey, items, newId) {
  const mine = (items || []).filter((x) => x.templateId === tpl.id);
  if (!isWeekly(tpl)) return mine.length ? [] : copiesFor(tpl, cal, periodKey, newId);
  const have = new Set(mine.map((x) => x.date));
  return copiesFor(tpl, cal, periodKey, newId).filter((c) => !have.has(c.date));
}

export function occursIn(tpl, cal, periodKey) {
  if (isWeekly(tpl)) {
    const { start, end } = cal.range(periodKey);
    return weeklyDates(tpl, start, end).length > 0;
  }
  return isOnCycle(tpl, periodKey);
}

// The first period, from `fromKey` on, that an item falls in.
export function nextPeriodOf(tpl, cal, fromKey) {
  if (!isWeekly(tpl)) return nextOnCycle(tpl, fromKey);
  const { start } = cal.range(fromKey);
  const first = parseDay(tpl.startDate);
  const next = first >= start ? first : weeklyDates(tpl, start, addDays(start, 14))[0];
  return next ? cal.keyFor(next) : fromKey;
}
