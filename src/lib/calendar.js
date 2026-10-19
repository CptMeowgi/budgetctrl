// One place that answers every question about budget periods: which period
// a day belongs to, where a period starts and ends, its neighbours, its
// label, the days in it. The rest of the app asks a calendar instead of
// passing the payday day around.
//
// A budget that never changed how it's paid has no `paySchedule`, and its
// calendar is monthly: exactly the answers the functions in periods.js and
// schedule.js always gave, built on them. A budget that switched holds its
// schedule over time,
//   paySchedule: [{ kind: "monthly", cutoffDay: 25 }, { kind: "weeks", every: 2, from: "2026-11-06" }]
// and its calendar follows each stretch of it in turn.

import {
  datesOnDay, dayRangeLabel, daysBetween, isRecurringDue, isoDay, itemDateInPeriod, monthKey, monthLabel,
  newEntryDate, parseDay, periodKeyFor, periodLabel, periodRange, recurringDateInPeriod, shortDay,
} from "./periods.js";
import { addMonths, isOnCycle, monthsBetween } from "./schedule.js";
import { isWeekly, monthlyDates, weeklyDates } from "./occurrences.js";

const isDayKey = (key) => /^\d{4}-\d{2}-\d{2}$/.test(String(key));
const dayOf = (value) => {
  const d = parseDay(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Every day from start to end, by the calendar (never by adding 24 hours,
// which a clock change turns into 23 or 25).
function daysIn({ start, end }) {
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(isoDay(d));
  return out;
}

const dayLabel = ({ start, end }) => ({ primary: dayRangeLabel(start, end), range: null });

// Periods running from payday `cutoffDay` to the day before it a month
// later, keyed by the month they start in ("2026-10").
export function monthlyCalendar(cutoffDay) {
  // As the app always has: a missing payday is the 1st.
  const cd = cutoffDay || 1;
  // A key spelling a day ("2026-11-06") belongs to some other schedule: a
  // budget whose schedule was damaged keeps them. It runs from that day to
  // the end of the monthly period around it, so it still opens by its dates.
  const range = (key) => {
    if (!isDayKey(key)) return periodRange(key, cd);
    const start = dayOf(key);
    return { start, end: periodRange(periodKeyFor(start, cd), cd).end };
  };
  return Object.freeze({
    kind: "monthly",
    cutoffDay: cd,
    // Plain calendar months, so the words say "month", not "period".
    calendarMonths: cd <= 1,
    // No pay schedule: every period is monthly.
    scheduled: false,
    keyFor: (date) => periodKeyFor(date, cd),
    current: (today = new Date()) => periodKeyFor(today, cd),
    range,
    next: (key) => addMonths(key, 1),
    prev: (key) => addMonths(key, -1),
    shift: (key, n) => addMonths(key, n),
    between: (fromKey, toKey) => monthsBetween(fromKey, toKey),
    label: (key) => (isDayKey(key) ? dayLabel(range(key)) : periodLabel(key, cd)),
    // For chart axes and table headings: "Oct".
    shortLabel: (key) => (isDayKey(key) ? shortDay(dayOf(key)) : monthLabel(key).slice(0, 3)),
    days: (key) => daysIn(range(key)),
    kindOf: (key) => (isDayKey(key) ? "weeks" : "monthly"),
    sameKind: (a, b) => isDayKey(a) === isDayKey(b),
    periodsPerMonth: () => 1,
    dateOf: (dayOfMonth, key) => recurringDateInPeriod(dayOfMonth, key, cd),
    itemDate: (item, key) => itemDateInPeriod(item, key, cd),
    isDue: (item, key, today) => isRecurringDue(item, key, today, cd),
    newEntryDate: (key, today) => newEntryDate(key, cd, today),
    // The monthly period an every-N-months bill counts its cycle by.
    cycleKey: (date) => periodKeyFor(date, cd),
    // The dates an item falls on in a period.
    occurrences: (item, key) => {
      const r = range(key);
      if (isWeekly(item)) return weeklyDates(item, r.start, r.end);
      if (isDayKey(key)) return monthlyDates(item, r.start, r.end, (d) => periodKeyFor(d, cd));
      return isOnCycle(item, key) ? [recurringDateInPeriod(item?.dayOfMonth, key, cd)] : [];
    },
  });
}

// A budget's pay schedule, or null when it has none or it is damaged. A
// damaged one (a hand-edited file, say) is ignored, never repaired: the
// budget opens as monthly on its payday day, and the console says so, once.
const warned = new WeakSet();
let warnedOther = false;
const isDate = (v) => typeof v === "string" && isDayKey(v) && isoDay(parseDay(v)) === v;
function validEntry(e, first) {
  if (!e || typeof e !== "object") return false;
  if (e.kind === "monthly") return Number.isInteger(e.cutoffDay) && e.cutoffDay >= 1 && e.cutoffDay <= 28 && (first || isDate(e.from));
  if (e.kind === "weeks") return (e.every === 1 || e.every === 2) && isDate(e.from);
  return false;
}
function validSchedule(s) {
  if (!Array.isArray(s) || !s.length || !s.every((e, i) => validEntry(e, i === 0))) return false;
  for (let i = 1; i < s.length; i++) {
    // Each stretch starts after the one before it.
    if (s[i - 1].from && !(s[i].from > s[i - 1].from)) return false;
    // `after`, when there, is the start of the period that runs on until
    // this stretch begins: a day before `from`, inside the stretch before.
    const { after } = s[i];
    if (after != null && !(isDate(after) && after < s[i].from && (!s[i - 1].from || after >= s[i - 1].from))) return false;
  }
  return true;
}
export function readSchedule(data) {
  const s = data?.paySchedule;
  if (s == null) return null;
  if (validSchedule(s)) return s;
  const first = typeof s === "object" ? !warned.has(s) : !warnedOther;
  if (typeof s === "object") warned.add(s);
  else warnedOther = true;
  if (first) console.warn("Budget Ctrl: this budget's pay schedule is damaged, so its periods are treated as monthly.", s);
  return null;
}

// Periods that follow a schedule. The first stretch reaches back to the
// beginning; each later one starts on its `from`, a payday, and the stretch
// before it ends the day before, so the period running at a switch is cut
// short there.
//
// Keys sort into date order as plain strings, which the rest of the app
// relies on. The first stretch, when monthly, keeps month keys ("2026-10"),
// so the months before a switch are untouched. Every other period is keyed by
// the day it starts ("2026-11-06"), monthly ones included, so a month that
// follows a fortnight still sorts after it.
function scheduleCalendar(schedule) {
  const stretches = schedule.map((e, i) => {
    const next = schedule[i + 1];
    return {
      kind: e.kind,
      cd: e.cutoffDay,
      every: e.every,
      step: e.kind === "weeks" ? 7 * e.every : 0,
      start: i === 0 ? null : dayOf(e.from),
      anchor: e.from ? dayOf(e.from) : null,
      end: next ? addDays(dayOf(next.from), -1) : null,
      // No period of this stretch starts after the next entry's `after`: the
      // one that starts then runs on to the stretch's end, shorter or longer
      // than usual.
      lastStart: next?.after ? dayOf(next.after) : null,
      monthKeys: i === 0 && e.kind === "monthly",
    };
  });
  const stretchAt = (d) => {
    for (let i = stretches.length - 1; i > 0; i--) if (stretches[i].start <= d) return stretches[i];
    return stretches[0];
  };
  const clip = (s, start, end) => ({
    start: s.start && s.start > start ? s.start : start,
    end: s.end && s.end < end ? s.end : end,
  });

  // The period of stretch `s` that day `d` falls in: { key, start, end, part, s }.
  // `part` marks one cut short or run on by a switch: it is never compared
  // with a whole one.
  const periodIn = (s, d) => {
    if (s.lastStart && d >= s.lastStart) {
      const p = basePeriod(s, s.lastStart);
      return { ...p, end: s.end, part: p.part || p.end.getTime() !== s.end.getTime() };
    }
    return basePeriod(s, d);
  };
  const basePeriod = (s, d) => {
    if (s.kind === "weeks") {
      const first = addDays(s.anchor, Math.floor(daysBetween(s.anchor, d) / s.step) * s.step);
      const last = addDays(first, s.step - 1);
      const r = clip(s, first, last);
      return { key: isoDay(first), ...r, part: r.end < last, s };
    }
    const month = periodKeyFor(d, s.cd);
    const { start, end } = periodRange(month, s.cd);
    const r = clip(s, start, end);
    return { key: s.monthKeys ? month : isoDay(r.start), ...r, part: r.start > start || r.end < end, s };
  };

  // The period a key names, when this schedule has one; null otherwise.
  const cache = new Map();
  const owned = (key) => {
    if (cache.has(key)) return cache.get(key);
    let p = null;
    if (isDayKey(key)) {
      const d = dayOf(key);
      const q = periodIn(stretchAt(d), d);
      if (q.key === key) p = q;
    } else if (stretches[0].monthKeys && /^\d{4}-\d{2}$/.test(String(key))) {
      const s = stretches[0];
      const { start } = periodRange(key, s.cd);
      const d = s.start && start < s.start ? s.start : start;
      if (!s.end || d <= s.end) {
        const q = periodIn(s, d);
        if (q.key === key) p = q;
      }
    }
    cache.set(key, p);
    return p;
  };

  const firstMonthly = stretches.find((s) => s.kind === "monthly");
  // A key this schedule doesn't make (a damaged file, an old backup): a day
  // key runs from that day to the end of the period around it; a month key
  // is that month on the payday the budget first had.
  const loose = (key) => {
    if (!isDayKey(key)) return periodRange(key, firstMonthly?.cd || 1);
    const start = dayOf(key);
    return { start, end: periodIn(stretchAt(start), start).end };
  };
  const range = (key) => {
    const p = owned(key);
    return p ? { start: p.start, end: p.end } : loose(key);
  };
  const keyFor = (date) => {
    const d = dayOf(date);
    return isNaN(d.getTime()) ? null : periodIn(stretchAt(d), d).key;
  };
  const kindOf = (key) => owned(key)?.s.kind || (isDayKey(key) ? "weeks" : "monthly");
  const stepOf = (key) => {
    const p = owned(key);
    if (!p) return kindOf(key);
    const kind = p.s.kind === "weeks" ? `weeks:${p.s.every}` : "monthly";
    return p.part ? `${kind}:part` : kind;
  };
  // Every-N-months bills count their cycle in the monthly periods the budget
  // began with, so a switch neither moves nor drops one of their payments.
  const cycleCd = stretches[0].kind === "monthly" ? stretches[0].cd : 1;
  const cycleKey = (date) => periodKeyFor(date, cycleCd);
  const next = (key) => keyFor(addDays(range(key).end, 1));
  const prev = (key) => keyFor(addDays(range(key).start, -1));
  const dateOf = (dayOfMonth, key) => {
    const r = range(key);
    return datesOnDay(dayOfMonth, r.start, r.end)[0] || r.start;
  };
  // In a fortnight a copy's own date wins; in a month its day of the month
  // does, as it always has (old data can carry a stray date).
  const itemDate = (item, key) => (kindOf(key) === "weeks"
    ? (item?.date ? dayOf(item.date) : dateOf(item?.dayOfMonth, key))
    : (item?.dayOfMonth == null && item?.date ? dayOf(item.date) : dateOf(item?.dayOfMonth, key)));

  const latest = schedule[schedule.length - 1];
  const lastMonthly = [...schedule].reverse().find((e) => e.kind === "monthly");
  return Object.freeze({
    kind: latest.kind,
    cutoffDay: lastMonthly?.cutoffDay || 1,
    calendarMonths: false,
    scheduled: true,
    keyFor,
    current: (today = new Date()) => keyFor(today),
    range,
    next,
    prev,
    shift: (key, n) => {
      let k = key;
      for (let i = 0; i < Math.abs(n); i++) k = n > 0 ? next(k) : prev(k);
      return k;
    },
    // How many periods from one key to another; negative going back.
    between: (from, to) => {
      if (from === to) return 0;
      const back = to < from;
      let k = from;
      for (let n = 1; n <= 10000; n++) {
        k = back ? prev(k) : next(k);
        if (back ? k <= to : k >= to) return back ? -n : n;
      }
      return NaN;
    },
    label: (key) => {
      const r = range(key);
      if (isNaN(r.start.getTime())) return { primary: String(key), range: null };
      if (kindOf(key) === "weeks") return dayLabel(r);
      // A monthly period is named by its month, with its days shown unless it
      // is exactly that calendar month.
      const whole = r.start.getDate() === 1 && addDays(r.end, 1).getDate() === 1 && r.start.getMonth() === r.end.getMonth();
      return { primary: monthLabel(monthKey(r.start)), range: whole ? null : `${shortDay(r.start)} – ${shortDay(r.end)}` };
    },
    shortLabel: (key) => {
      const r = range(key);
      if (isNaN(r.start.getTime())) return String(key);
      return kindOf(key) === "weeks" ? shortDay(r.start) : monthLabel(monthKey(r.start)).slice(0, 3);
    },
    days: (key) => daysIn(range(key)),
    kindOf,
    sameKind: (a, b) => stepOf(a) === stepOf(b),
    // How many of these periods a month holds, for figures kept per month.
    periodsPerMonth: (key) => {
      const p = owned(key);
      return p?.s.kind === "weeks" ? 52 / (12 * p.s.every) : 1;
    },
    dateOf,
    itemDate,
    isDue: (item, key, today) => {
      const r = range(key);
      if (today > r.end) return true;
      if (today < r.start) return false;
      return today >= itemDate(item, key);
    },
    newEntryDate: (key, today) => (keyFor(today) === key ? isoDay(today) : isoDay(range(key).start)),
    // The dates an item falls on in a period. Month-keyed periods count a
    // bill's cycle by period, as they always have; the rest by the month the
    // bill falls in.
    occurrences: (item, key) => {
      const r = range(key);
      if (isWeekly(item)) return weeklyDates(item, r.start, r.end);
      if (owned(key)?.s.monthKeys) return isOnCycle(item, key) ? datesOnDay(item?.dayOfMonth, r.start, r.end).slice(0, 1) : [];
      return monthlyDates(item, r.start, r.end, cycleKey);
    },
    // The monthly period an every-N-months bill counts its cycle by.
    cycleKey,
  });
}

// The calendar a budget's periods follow. The same schedule always gets the
// same calendar, so what it has worked out is kept between renders.
const calendars = new WeakMap();
export function calendarFor(data) {
  const schedule = readSchedule(data);
  if (!schedule) return monthlyCalendar(data?.cutoffDay);
  // A schedule that never left its first monthly stretch is plain monthly.
  if (schedule.length === 1 && schedule[0].kind === "monthly") return monthlyCalendar(schedule[0].cutoffDay);
  if (!calendars.has(schedule)) calendars.set(schedule, scheduleCalendar(schedule));
  return calendars.get(schedule);
}

// Library functions accept a calendar, or a payday number as shorthand for
// a monthly one (which is how the tests and older callers pass it).
export function asCalendar(calendarOrCutoff) {
  return calendarOrCutoff && typeof calendarOrCutoff.keyFor === "function"
    ? calendarOrCutoff
    : monthlyCalendar(calendarOrCutoff);
}
