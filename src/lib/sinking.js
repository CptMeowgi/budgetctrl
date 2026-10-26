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

// Every period a bill has been saved for in, from the one saving started in
// to the one it's next due in, each with when its cycle ends and how many
// periods that cycle has left. A cycle runs from the period after the bill
// was last due to the one it's due in.
function timeline(tpl, cal, curKey) {
  const nextDue = nextPeriodOf(tpl, cal, curKey);
  if (!occursIn(tpl, cal, nextDue)) return null;
  let from = tpl.saveUp?.from || curKey;
  if (from > curKey) from = curKey;
  const keys = [];
  for (let k = from, i = 0; k <= nextDue && i < 2000; k = cal.next(k), i++) keys.push(k);
  const due = new Set(keys.filter((k) => occursIn(tpl, cal, k)));
  // Walking back from the end: each period's due period, and how far off it is.
  const cycle = new Map();
  let dueKey = nextDue;
  let left = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    if (due.has(k)) { dueKey = k; left = 0; }
    left++;
    cycle.set(k, { dueKey, left });
  }
  return { keys, due, cycle, nextDue };
}

// [{ id, name, category, amount, dueKey, dueDate, periodsLeft, saved,
//    thisPeriod, savedAfter, dueNow, paidFromFund }], soonest due first.
//   saved         set aside before this period
//   thisPeriod    this period's share; once the bill is paid in the period
//                 it's due, nothing: the rest of the bill is in its spending
//   paidFromFund  in the period it's due, once paid: what was saved before
export function sinkingFunds(data, today = new Date()) {
  const tmpls = (data.recurringTemplate || []).filter((t) => t.saveUp && canSaveUp(t));
  if (!tmpls.length) return [];
  const cal = calendarFor(data);
  const curKey = cal.current(today);
  const funds = tmpls.map((tpl) => ({ tpl, line: timeline(tpl, cal, curKey), saved: 0 })).filter((f) => f.line);
  if (!funds.length) return [];

  // What a bill's own copies in a period came to, once due.
  const paidIn = (f, k) => (data.months?.[k]?.recurring || [])
    .filter((r) => r.templateId === f.tpl.id && cal.isDue(r, k, today))
    .reduce((a, r) => a + (r.amount || 0), 0);
  const share = (f, k) => cents(Math.max(0, f.tpl.amount - f.saved) / f.line.cycle.get(k).left);

  // Past periods, oldest first. Each had what it took in, less what it
  // spent and the savings set-aside, plus any bill a fund paid for it; the
  // funds still saving then share that out, the one due soonest first.
  const past = [...new Set(funds.flatMap((f) => f.line.keys.filter((k) => k < curKey)))].sort();
  for (const k of past) {
    const m = data.months?.[k];
    const open = funds.filter((f) => f.line.cycle.has(k))
      .sort((a, b) => (a.line.cycle.get(k).dueKey < b.line.cycle.get(k).dueKey ? -1 : 1));
    // A bill due here is paid from what its fund had saved; its cycle ends.
    let fromFunds = 0;
    const ending = open.filter((f) => f.line.due.has(k));
    for (const f of ending) fromFunds += Math.min(paidIn(f, k), f.saved);
    let left = m ? Math.max(0, periodIncome(m, k, today, cal).total - periodSpending(m, k, today, cal).total
      + fromFunds - perPeriodOf(data.savingsGoal?.monthly, cal, k)) : 0;
    for (const f of open) {
      if (f.line.due.has(k)) continue;
      const take = Math.min(share(f, k), left);
      f.saved = cents(f.saved + take);
      left = Math.max(0, left - take);
    }
    for (const f of ending) f.saved = 0;
  }

  return funds
    .map((f) => {
      const { dueKey, left } = f.line.cycle.get(curKey);
      const dueNow = f.line.due.has(curKey);
      const paid = dueNow ? paidIn(f, curKey) : 0;
      const thisPeriod = paid > 0 ? 0 : share(f, curKey);
      const due = cal.occurrences(f.tpl, dueKey)[0];
      return {
        id: f.tpl.id, name: f.tpl.name, category: f.tpl.category, amount: f.tpl.amount,
        dueKey, dueDate: due ? isoDay(due) : null, periodsLeft: left,
        saved: f.saved, thisPeriod, savedAfter: cents(f.saved + thisPeriod),
        dueNow, paidFromFund: cents(Math.min(paid, f.saved)),
      };
    })
    .sort((a, b) => (a.dueKey < b.dueKey ? -1 : a.dueKey > b.dueKey ? 1 : 0));
}

// This period, over all funds: what to set aside, and what they pay.
export function fundTotals(funds) {
  return {
    setAside: cents(funds.reduce((a, f) => a + f.thisPeriod, 0)),
    paidFromFund: cents(funds.reduce((a, f) => a + f.paidFromFund, 0)),
  };
}
