// What the rest of this period holds: each bill, payment and expected credit
// on its day, and where the money left this period is heading - its lowest
// point, and whether it runs out before payday.
//
// "Money left" starts as the Dashboard's Remaining (income received less
// spending so far). From tomorrow it falls by each bill still to come, rises
// with each credit still expected, and - for the realistic line - falls by
// your usual everyday spending: the average daily one-off spending of the
// last three finished periods.

import { periodRange, recurringDateInPeriod, isRecurringDue, isoDay } from "./periods.js";
import { upcomingSettled } from "./reminders.js";
import { creditReceived, periodIncome, periodSpending } from "./totals.js";
import { addMonths } from "./schedule.js";

// Every day of a period, by the calendar (never by adding 24 hours, which a
// clock change turns into 23 or 25).
export function periodDays(periodKey, cutoffDay) {
  const { start } = periodRange(periodKey, cutoffDay);
  const stop = isoDay(periodRange(addMonths(periodKey, 1), cutoffDay).start);
  const out = [];
  for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); isoDay(d) !== stop;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(isoDay(d));
  }
  return out;
}

// Everything scheduled in a period, on its day, and whether it has happened:
// done, still due, or overdue (an unpaid payment whose day has passed).
export function scheduledItems(data, periodKey, today) {
  const cutoffDay = data.cutoffDay || 1;
  const m = data.months?.[periodKey] || {};
  const todayIso = isoDay(today);
  const items = [];
  for (const r of m.recurring || []) {
    items.push({
      date: isoDay(recurringDateInPeriod(r.dayOfMonth, periodKey, cutoffDay)), kind: "recurring", id: r.id,
      name: r.name, amount: -(r.amount || 0), autoPay: !!r.autoPay,
      status: isRecurringDue(r, periodKey, today, cutoffDay) ? "done" : "due",
    });
  }
  for (const u of m.upcoming || []) {
    if (!u.dueDate) continue;
    const settled = upcomingSettled(u, today);
    items.push({
      date: u.dueDate, kind: "upcoming", id: u.id, name: u.name, amount: -(u.amount || 0), autoPay: !!u.autoPay,
      status: settled ? "done" : u.dueDate < todayIso ? "overdue" : "due",
    });
  }
  for (const c of m.credits || []) {
    const date = c.dayOfMonth != null ? isoDay(recurringDateInPeriod(c.dayOfMonth, periodKey, cutoffDay)) : (c.date || "");
    if (!date) continue;
    items.push({
      date, kind: "credit", id: c.id, name: c.name, amount: c.amount || 0,
      status: creditReceived(c, periodKey, today, cutoffDay) ? "done" : "due",
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
}

// Average one-off spending per day over the last `n` periods before this one.
export function everydayRate(data, periodKey, n = 3) {
  const cutoffDay = data.cutoffDay || 1;
  const keys = Object.keys(data.months || {}).filter((k) => k < periodKey).sort().slice(-n);
  let spent = 0;
  let days = 0;
  for (const k of keys) {
    spent += (data.months[k].expenses || []).reduce((a, e) => a + (e.amount || 0), 0);
    days += periodDays(k, cutoffDay).length;
  }
  return days ? spent / days : 0;
}

export function forecast(data, periodKey, today) {
  const cutoffDay = data.cutoffDay || 1;
  const m = data.months?.[periodKey];
  const todayIso = isoDay(today);
  const now = periodIncome(m, periodKey, today, cutoffDay).total - periodSpending(m, periodKey, today, cutoffDay).total;
  const pending = scheduledItems(data, periodKey, today).filter((it) => it.status !== "done");
  const rate = everydayRate(data, periodKey);
  const ahead = periodDays(periodKey, cutoffDay).filter((d) => d > todayIso);

  let balance = now;
  let withEveryday = now;
  const series = [{ date: todayIso, balance, withEveryday, items: [] }];
  ahead.forEach((d, i) => {
    // An overdue payment is owed already; count it on the first day ahead.
    const items = pending.filter((it) => it.date === d || (i === 0 && it.date <= todayIso));
    const delta = items.reduce((a, it) => a + it.amount, 0);
    balance += delta;
    withEveryday += delta - rate;
    series.push({ date: d, balance, withEveryday, items });
  });

  const lowest = (key) => series.reduce((lo, p) => (p[key] < lo[key] ? p : lo), series[0]);
  const low = lowest("balance");
  const lowE = lowest("withEveryday");
  const last = series[series.length - 1];
  return {
    now, rate, series,
    lowest: { date: low.date, amount: low.balance },
    lowestWithEveryday: { date: lowE.date, amount: lowE.withEveryday },
    end: last.balance,
    endWithEveryday: last.withEveryday,
    // The first day the realistic line goes below zero, if it does.
    runsShortOn: series.find((p) => p.withEveryday < 0)?.date || null,
  };
}

// The days of a period up to today - all of them once it has ended.
function daysSoFar(periodKey, cutoffDay, today) {
  const todayIso = isoDay(today);
  return periodDays(periodKey, cutoffDay).filter((d) => d <= todayIso);
}

const dayDate = (iso) => new Date(`${iso}T00:00:00`);

// What had been spent by the end of day `d`, by the same rules as Remaining:
// an expense on its date, a recurring bill on its day, an Upcoming payment
// once settled. What is dated after today, or was paid early, counts as of
// today - so the last day always agrees with the Dashboard.
function spentBy(m, periodKey, cutoffDay, d, todayIso) {
  let total = 0;
  for (const e of m?.expenses || []) if (!e.date || e.date <= d || d === todayIso) total += e.amount || 0;
  for (const r of m?.recurring || []) if (isRecurringDue(r, periodKey, dayDate(d), cutoffDay)) total += r.amount || 0;
  for (const u of m?.upcoming || []) {
    if (!upcomingSettled(u, dayDate(todayIso))) continue;
    if (!u.dueDate || u.dueDate <= d || d === todayIso) total += u.amount || 0;
  }
  return total;
}

// Money left at the end of each day so far: what the forecast's line comes
// from. Income counts from the first day; a credit from the day it arrived.
export function balanceHistory(data, periodKey, today) {
  const cutoffDay = data.cutoffDay || 1;
  const m = data.months?.[periodKey];
  const todayIso = isoDay(today);
  return daysSoFar(periodKey, cutoffDay, today).map((d) => {
    const income = periodIncome(m, periodKey, dayDate(d), cutoffDay).total;
    return { date: d, balance: income - spentBy(m, periodKey, cutoffDay, d, todayIso) };
  });
}

// Spending added up day by day, to today or to the end of a finished period.
export function spendingByDay(data, periodKey, today) {
  const cutoffDay = data.cutoffDay || 1;
  const m = data.months?.[periodKey];
  const days = daysSoFar(periodKey, cutoffDay, today);
  const last = days[days.length - 1];
  return days.map((d) => ({ date: d, total: spentBy(m, periodKey, cutoffDay, d, last) }));
}
