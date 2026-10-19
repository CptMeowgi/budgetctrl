// Changing how a budget is paid: monthly on a payday day, every two weeks or
// every week. One pure function makes the change and says what it will do,
// so the preview in the dialog and the change it saves can never disagree.
//
// Periods before the running one are never touched. The running period ends
// the day before the first new payday (or runs on to it), and what's dated on
// or after that payday moves into the new periods, which start with their
// bills and, the first of them, the paycheck as income.

import { calendarFor, readSchedule } from "./calendar.js";
import { capAt, withCap } from "./envelopes.js";
import { isRecurringItem } from "./occurrences.js";
import { isoDay, parseDay } from "./periods.js";
import { emptyMonth, startPeriod } from "../model.js";

// The choices, as the Settings and welcome screens offer them.
export const PAY_KINDS = [
  { id: "monthly", label: "Monthly" },
  { id: "weeks:2", label: "Every 2 weeks" },
  { id: "weeks:1", label: "Every week" },
];

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// How the running period is paid: the latest schedule entry that has begun.
export function payKindNow(data, today) {
  const schedule = readSchedule(data);
  if (!schedule) return "monthly";
  const day = isoDay(today);
  const begun = schedule.filter((e, i) => i === 0 || e.from <= day);
  const e = begun[begun.length - 1];
  return e.kind === "weeks" ? `weeks:${e.every}` : "monthly";
}

// How the budget is set to be paid: its latest schedule entry, whether or
// not that has begun. Settings shows this, so a switch still to come can be
// changed or taken back there.
export function payKindChosen(data) {
  const schedule = readSchedule(data);
  const e = schedule?.[schedule.length - 1];
  return e?.kind === "weeks" ? `weeks:${e.every}` : "monthly";
}

// The first day `cutoffDay` after the running period ends: where a monthly
// schedule picks up, so the running period runs on to it.
export function firstPaydayFor(data, cutoffDay, today) {
  const cal = calendarFor(data);
  let d = addDays(cal.range(cal.current(today)).end, 1);
  while (d.getDate() !== cutoffDay) d = addDays(d, 1);
  return isoDay(d);
}

// The set-aside is kept per month and shown per period: a fortnight sets
// aside 12/26 of the monthly figure. Monthly periods use it as it is.
export function perPeriodOf(monthly, cal, key) {
  const ppm = cal.periodsPerMonth(key);
  const m = Number(monthly) || 0;
  return ppm === 1 ? m : Math.round(m / ppm);
}
export function perMonthOf(perPeriod, cal, key) {
  const ppm = cal.periodsPerMonth(key);
  const v = Number(perPeriod) || 0;
  return ppm === 1 ? v : Math.round(v * ppm * 100) / 100;
}

// The budget as if a switch still to come had never been made: the schedule
// entries that begin after the running period started are dropped. Back to a
// single monthly stretch, it never switched at all. (The periods and budgets
// that switch made ahead of time are cleared by switchSchedule.)
function withoutPending(data, today) {
  const schedule = readSchedule(data);
  if (!schedule) return data;
  const cal = calendarFor(data);
  const start = isoDay(cal.range(cal.current(today)).start);
  const kept = schedule.filter((e, i) => i === 0 || e.from <= start);
  if (kept.length === schedule.length) return data;
  if (kept.length === 1 && kept[0].kind === "monthly") {
    const { paySchedule: _gone, ...rest } = data;
    return { ...rest, cutoffDay: kept[0].cutoffDay };
  }
  return { ...data, paySchedule: kept };
}

// options: { kind: "monthly" | "weeks", every: 1 | 2, cutoffDay, firstPayday, paycheck }.
// Returns { data, preview }; on an error, `data` is the budget it was given.
export function switchSchedule(data, options, today) {
  const { kind, every, cutoffDay } = options;
  // A switch still to come is cleared first, so a new one replaces it.
  const nowCal = calendarFor(data);
  const base = withoutPending(data, today);
  const oldCal = calendarFor(base);
  const curKey = oldCal.current(today);
  const cur = oldCal.range(curKey);
  const first = kind === "monthly" ? firstPaydayFor(base, cutoffDay, today) : options.firstPayday;
  const firstDay = parseDay(first);

  // The first payday falls after the running period starts (on its first day
  // it would leave the period empty), and no more than 31 days after it ends.
  const error = isNaN(firstDay.getTime()) || firstDay <= cur.start ? "too-early"
    : firstDay > addDays(cur.end, 31) ? "too-late" : null;
  if (error) return { data, preview: { error, firstPayday: first } };

  const startIso = isoDay(cur.start);
  const baseSchedule = readSchedule(base) || [{ kind: "monthly", cutoffDay: base.cutoffDay || 1 }];
  const last = baseSchedule[baseSchedule.length - 1];
  // Monthly on the payday the budget already follows, from its usual next
  // payday: nothing to switch to; only a switch still to come is taken back.
  const nothingNew = kind === "monthly" && last.kind === "monthly" && last.cutoffDay === cutoffDay
    && first === isoDay(addDays(cur.end, 1));
  const entry = kind === "monthly"
    ? { kind: "monthly", cutoffDay, from: first, after: startIso }
    : { kind: "weeks", every, from: first, after: startIso };
  const paySchedule = nothingNew ? null : [...baseSchedule, entry];
  const newCal = nothingNew ? oldCal : calendarFor({ paySchedule });
  const firstKey = newCal.keyFor(firstDay);
  const running = newCal.current(today);
  const lastNew = nothingNew || running > firstKey ? running : firstKey;

  // Budgets and the suggested paycheck, per new period.
  const factor = nothingNew ? 1 : oldCal.periodsPerMonth(curKey) / newCal.periodsPerMonth(firstKey);
  const convert = (x) => Math.round((Number(x) || 0) * factor);
  const paycheckDefault = convert(data.months?.[curKey]?.income);
  const paycheck = Number.isFinite(options.paycheck) ? options.paycheck : paycheckDefault;

  // Deal out the running period's entries, and those of any period after it
  // (made ahead of time by a switch this one replaces). What's dated before
  // the first payday stays; the rest goes to the new period of its date, or
  // the last one made. Recurring copies that move are made afresh there.
  const stay = emptyMonth();
  const moved = {};
  let movedCount = 0;
  const placeOf = (date) => {
    const k = newCal.keyFor(date);
    return k > lastNew ? lastNew : k;
  };
  const into = (k) => (k === curKey ? stay : (moved[k] ||= emptyMonth()));
  const later = Object.keys(data.months || {}).filter((k) => k > curKey);
  for (const k of [curKey, ...later]) {
    const m = data.months?.[k];
    if (!m) continue;
    const counts = k === curKey;
    const deal = (list, x, date) => {
      if (!date || date < first) { stay[list].push(x); return; }
      into(placeOf(date))[list].push(x);
      if (counts) movedCount++;
    };
    for (const e of m.expenses || []) deal("expenses", e, e.date);
    for (const u of m.upcoming || []) deal("upcoming", u, u.dueDate);
    for (const c of m.credits || []) {
      if (!isRecurringItem(c)) { deal("credits", c, c.date); continue; }
      if (counts && isoDay(oldCal.itemDate(c, k)) < first) stay.credits.push(c);
      else if (counts) movedCount++;
    }
    for (const r of m.recurring || []) {
      if (counts && isoDay(oldCal.itemDate(r, k)) < first) stay.recurring.push(r);
      else if (counts) movedCount++;
    }
  }

  const months = { ...data.months };
  for (const k of later) delete months[k];
  // Only the entries change: the running period keeps its income and fields.
  months[curKey] = { ...data.months[curKey], expenses: stay.expenses, recurring: stay.recurring, upcoming: stay.upcoming, credits: stay.credits };

  // Budgets a switch still to come set for its periods go with it; the rest
  // convert from the first new period on.
  const trimmed = (c) => {
    if (!c.capHistory?.some((h) => h.from > curKey)) return c;
    const capHistory = c.capHistory.filter((h) => h.from <= curKey);
    const out = { ...c, capHistory };
    const cap = capAt(out, curKey);
    if (cap == null) delete out.cap;
    else out.cap = cap;
    return out;
  };
  const categories = (base.categories || []).map((c0) => {
    const c = trimmed(c0);
    const before = capAt(c, curKey);
    return before == null || convert(before) === before ? c : withCap(c, convert(before), firstKey);
  });
  const next = nothingNew
    ? { ...base, categories, months }
    : { ...base, paySchedule, cutoffDay: kind === "monthly" ? cutoffDay : base.cutoffDay, categories, months };
  // Each new period up to today's, with its bills; the first with the paycheck.
  if (!nothingNew) {
    for (let k = firstKey; k <= lastNew; k = newCal.next(k)) {
      const p = startPeriod(next, newCal, k, moved[k] || emptyMonth());
      next.months[k] = k === firstKey ? { ...p, income: paycheck } : p;
    }
  }

  const newEnd = newCal.range(curKey).end;
  const nowEnd = nowCal.range(curKey).end;
  const labels = [firstKey];
  while (labels.length < 3) labels.push(newCal.next(labels[labels.length - 1]));
  return {
    data: next,
    preview: {
      error: null,
      firstPayday: first,
      firstKey,
      periods: labels.map((k) => newCal.label(k).primary),
      current: {
        key: curKey,
        start: startIso,
        end: isoDay(newEnd),
        change: newEnd < nowEnd ? "shortened" : newEnd > nowEnd ? "lengthened" : "same",
      },
      moved: movedCount,
      paycheck: paycheckDefault,
      budgets: categories.filter((c) => capAt(c, curKey) != null)
        .map((c) => ({ name: c.name, before: capAt(c, curKey), after: convert(capAt(c, curKey)) })),
      setAside: { before: perPeriodOf(data.savingsGoal?.monthly, oldCal, curKey), after: perPeriodOf(data.savingsGoal?.monthly, newCal, firstKey) },
    },
  };
}
