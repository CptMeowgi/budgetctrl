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
// what each past period had left over, after the savings set-aside. Once
// leftovers carry (see carryover.js), that includes what a period was
// carried into it, so the same walk that saves for bills also works out the
// carry: the two can never disagree.

import { calendarFor } from "./calendar.js";
import { isWeekly, nextPeriodOf, occursIn } from "./occurrences.js";
import { perPeriodOf, splitPeriod } from "./setAside.js";
import { setAsideAt } from "./setAsideHistory.js";
import { isoDay } from "./periods.js";
import { periodIncome, periodSpending } from "./totals.js";

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
// The carry is kept to the cent, so float dust never reads as money carried
// (and never as -0, which a number format would print with its sign).
const money = (n) => cents(n) || 0;

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
  const { funds, cal, curKey, paidIn, share } = walkPeriods(data, today);
  if (!funds.length) return [];
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

// Each finished period's part in saving up for bills: what it put aside
// (`saved`) and what bills it paid from what was saved before (`paid`).
// Only periods with either are listed.
export function fundHistory(data, today = new Date()) {
  return walkPeriods(data, today).history;
}

// Where carrying starts, or null when leftovers don't carry. A budget whose
// carry has no start never carries, as in 0.8.0.
function carryStart(data) {
  const c = data.carry;
  return c?.on && typeof c.from === "string" ? c.from : null;
}

// The one walk through the finished periods, oldest first, saving up for
// each bill and, from where carrying starts, carrying what's left on.
//
//   history  each period's part in saving up for bills (see fundHistory)
//   chain    from where carrying starts, each recorded period's split:
//            { carriedIn, setAsideApplied, billsSaved, billsPaid,
//              billsReleased, carriedOut }
//   carryOn  what the running period starts with
//
// carryover.js reads the chain from here. It lives in this loop, not a loop
// of its own, because what a period can save for bills depends on what was
// carried into it, and what it carries depends on what it saved.
export function walkPeriods(data, today = new Date()) {
  const cal = calendarFor(data);
  const curKey = cal.current(today);
  const tmpls = (data.recurringTemplate || []).filter((t) => t.saveUp && canSaveUp(t));
  const funds = tmpls.map((tpl) => ({ tpl, line: timeline(tpl, cal, curKey), saved: 0 })).filter((f) => f.line);

  // What a bill's own copies in a period came to, once due.
  const paidIn = (f, k) => (data.months?.[k]?.recurring || [])
    .filter((r) => r.templateId === f.tpl.id && cal.isDue(r, k, today))
    .reduce((a, r) => a + (r.amount || 0), 0);
  const share = (f, k) => cents(Math.max(0, f.tpl.amount - f.saved) / f.line.cycle.get(k).left);
  // The set-aside that applied then, so changing it today leaves the past be.
  const setAsideIn = (k) => perPeriodOf(setAsideAt(data, k), cal, k);

  // Every period a fund was saving in, and, once carrying starts, every
  // period the budget has a record of: a period with no bills still carries.
  // Keys sort into date order as plain strings, a switch of pay schedule
  // included.
  const from = carryStart(data);
  const resets = from && Array.isArray(data.carry.resets) ? data.carry.resets : [];
  const keys = new Set(funds.flatMap((f) => f.line.keys.filter((k) => k < curKey)));
  if (from) for (const k of Object.keys(data.months || {})) if (k >= from && k < curKey) keys.add(k);

  const history = new Map();
  const chain = new Map();
  // From where carrying starts: what carries on so far, bill savings let go
  // that no recorded period has taken in yet, and the last period walked.
  let carried = 0;
  let released = 0;
  let walked = null;
  // "Start fresh" (carry.resets): a listed period starts at 0, whatever came
  // before. It takes effect at the first period walked at or after it, or
  // at the running one. This is the only place the rule is applied;
  // carriedInto reads its outcome.
  const startFresh = (k) => {
    if (resets.some((r) => (walked == null || r > walked) && r <= k)) {
      carried = 0;
      released = 0;
    }
  };

  for (const k of [...keys].sort()) {
    const m = data.months?.[k];
    const open = funds.filter((f) => f.line.cycle.has(k))
      .sort((a, b) => (a.line.cycle.get(k).dueKey < b.line.cycle.get(k).dueKey ? -1 : 1));
    // A bill due here is paid from what its fund had saved; its cycle ends.
    // Whatever the fund had beyond that (the bill cost less, or wasn't paid)
    // is let go.
    let fromFunds = 0;
    let letGo = 0;
    const ending = open.filter((f) => f.line.due.has(k));
    for (const f of ending) {
      const paid = Math.min(paidIn(f, k), f.saved);
      fromFunds += paid;
      letGo += f.saved - paid;
    }
    const saving = open.filter((f) => !f.line.due.has(k));

    // From the start, money let go goes back into the period's money: it
    // was the period's before it was saved. A period with no record holds
    // it for the next recorded one. Before the start it simply goes, as in
    // 0.8.0.
    const counting = from != null && k >= from;
    if (counting) {
      startFresh(k);
      released = cents(released + letGo);
      walked = k;
    }

    // What's left for bills after the set-aside. Before carrying starts (or
    // with it off), 0.8.0's own figure: the period's money alone. From the
    // start, the split, with what the period before carried in. A period
    // with no record saves nothing and carries nothing: what came before
    // passes on to the next one untouched.
    let left;
    if (counting && m) {
      const carriedIn = carried;
      const income = periodIncome(m, k, today, cal).total;
      const spent = periodSpending(m, k, today, cal).total;
      const billsWanted = cents(saving.reduce((a, f) => a + share(f, k), 0));
      const split = splitPeriod({ carriedIn, income, spent, paidFromFund: fromFunds, billsReleased: released,
        setAside: setAsideIn(k), billsWanted });
      left = split.billsSaved;
      const step = {
        carriedIn,
        setAsideApplied: money(split.setAsideApplied),
        billsSaved: money(split.billsSaved),
        billsPaid: money(fromFunds),
        billsReleased: money(released),
        carriedOut: money(split.carriedOut),
      };
      chain.set(k, step);
      carried = step.carriedOut;
      released = 0;
    } else {
      left = m ? Math.max(0, periodIncome(m, k, today, cal).total - periodSpending(m, k, today, cal).total
        + fromFunds - setAsideIn(k)) : 0;
    }

    // The funds still saving share that out, the one due soonest first.
    let took = 0;
    for (const f of saving) {
      const take = Math.min(share(f, k), left);
      f.saved = cents(f.saved + take);
      took += take;
      left = Math.max(0, left - take);
    }
    for (const f of ending) f.saved = 0;
    if (took || fromFunds) history.set(k, { saved: cents(took), paid: cents(fromFunds) });
  }

  // What the running period starts with: the same rules, one step on.
  let carryOn = 0;
  if (from != null && curKey >= from) {
    startFresh(curKey);
    carryOn = money(carried + released);
  }

  return { funds, cal, curKey, paidIn, share, history, chain, carryOn };
}

// This period, over all funds: what to set aside, and what they pay.
export function fundTotals(funds) {
  return {
    setAside: cents(funds.reduce((a, f) => a + f.thisPeriod, 0)),
    paidFromFund: cents(funds.reduce((a, f) => a + f.paidFromFund, 0)),
  };
}
