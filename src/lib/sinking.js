// Saving up for bills that come round every few months or once a year
// (sinking funds). A bill marked `saveUp: { from }` sets aside a share each
// period, from the period after it was last due (or the one saving started
// in, if later) to the one it's due in. The share is what's still to save
// over the periods left, the due one included, so a fund started late, or a
// period with nothing left over, is caught up gradually. When the bill is
// paid, it's paid out of what was saved, so the period it's due in costs
// only its own share.
//
// Nothing is stored but the setting: what's been saved is worked out from
// what each past period had left over, after the savings set-aside.

import { calendarFor } from "./calendar.js";
import { isWeekly, nextPeriodOf, occursIn } from "./occurrences.js";
import { perPeriodOf } from "./paySchedule.js";
import { isoDay } from "./periods.js";
import { periodIncome, periodSpending } from "./totals.js";

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Bills that come round every few months or yearly. A monthly or weekly bill
// is simply paid each time.
export function canSaveUp(tpl) {
  return !!tpl && !isWeekly(tpl) && tpl.dayOfMonth != null && (Number(tpl.every) || 1) > 1;
}

// The periods a bill is saved for over, ending with the one it's due in.
function cycleOf(tpl, cal, curKey) {
  const dueKey = nextPeriodOf(tpl, cal, curKey);
  if (!occursIn(tpl, cal, dueKey)) return null;
  // When it was last due: back at most a few cycles' worth of periods.
  const steps = Math.ceil((Number(tpl.every) || 1) * 5) + 2;
  let prev = null;
  for (let k = dueKey, i = 0; i < steps; i++) {
    const p = cal.prev(k);
    if (!p || p === k) break;
    k = p;
    if (occursIn(tpl, cal, k)) { prev = k; break; }
  }
  const from = tpl.saveUp?.from || curKey;
  let start = prev ? cal.next(prev) : from;
  if (from > start) start = from;
  if (start > curKey) start = curKey;
  const keys = [];
  for (let k = start, i = 0; k <= dueKey && i < 400; k = cal.next(k), i++) keys.push(k);
  return { dueKey, keys };
}

// [{ id, name, category, amount, dueKey, dueDate, periodsLeft, saved,
//    thisPeriod, savedAfter, dueNow, paidFromFund }], soonest due first.
//   saved         set aside before this period
//   thisPeriod    this period's share
//   paidFromFund  in the period it's due, once paid: what the fund covers
export function sinkingFunds(data, today = new Date()) {
  const tmpls = (data.recurringTemplate || []).filter((t) => t.saveUp && canSaveUp(t));
  if (!tmpls.length) return [];
  const cal = calendarFor(data);
  const curKey = cal.current(today);
  const ids = new Set(tmpls.map((t) => t.id));
  const funds = tmpls.map((tpl) => ({ tpl, cycle: cycleOf(tpl, cal, curKey) }))
    .filter((f) => f.cycle)
    .sort((a, b) => (a.cycle.dueKey < b.cycle.dueKey ? -1 : a.cycle.dueKey > b.cycle.dueKey ? 1 : 0));

  const share = (f, k, saved) => {
    const left = f.cycle.keys.length - f.cycle.keys.indexOf(k);
    return left > 0 ? cents(Math.max(0, f.tpl.amount - saved) / left) : 0;
  };
  // What a past period had left over to save: income less spending and the
  // savings set-aside. A bill being saved for was paid from its own fund.
  const leftOver = (k) => {
    const m = data.months?.[k];
    if (!m) return 0;
    const funded = (m.recurring || []).filter((r) => ids.has(r.templateId) && cal.isDue(r, k, today))
      .reduce((a, r) => a + (r.amount || 0), 0);
    const spent = periodSpending(m, k, today, cal).total - funded;
    return Math.max(0, periodIncome(m, k, today, cal).total - spent - perPeriodOf(data.savingsGoal?.monthly, cal, k));
  };

  // Past periods, oldest first; the bill due soonest takes its share first.
  const saved = new Map(funds.map((f) => [f.tpl.id, 0]));
  const past = [...new Set(funds.flatMap((f) => f.cycle.keys.filter((k) => k < curKey)))].sort();
  for (const k of past) {
    let left = leftOver(k);
    for (const f of funds) {
      if (!f.cycle.keys.includes(k)) continue;
      const take = Math.min(share(f, k, saved.get(f.tpl.id)), left);
      saved.set(f.tpl.id, cents(saved.get(f.tpl.id) + take));
      left = Math.max(0, left - take);
    }
  }

  return funds.map((f) => {
    const before = saved.get(f.tpl.id);
    const thisPeriod = f.cycle.keys.includes(curKey) ? share(f, curKey, before) : 0;
    const dueNow = f.cycle.dueKey === curKey;
    const paid = dueNow
      ? (data.months?.[curKey]?.recurring || []).filter((r) => r.templateId === f.tpl.id && cal.isDue(r, curKey, today))
        .reduce((a, r) => a + (r.amount || 0), 0)
      : 0;
    const due = cal.occurrences(f.tpl, f.cycle.dueKey)[0];
    return {
      id: f.tpl.id, name: f.tpl.name, category: f.tpl.category, amount: f.tpl.amount,
      dueKey: f.cycle.dueKey, dueDate: due ? isoDay(due) : null,
      periodsLeft: f.cycle.keys.length - f.cycle.keys.indexOf(curKey),
      saved: before, thisPeriod, savedAfter: cents(before + thisPeriod),
      dueNow, paidFromFund: cents(Math.min(paid, before + thisPeriod)),
    };
  });
}

// This period, over all funds: what to set aside, and what they pay.
export function fundTotals(funds) {
  return {
    setAside: cents(funds.reduce((a, f) => a + f.thisPeriod, 0)),
    paidFromFund: cents(funds.reduce((a, f) => a + f.paidFromFund, 0)),
  };
}
