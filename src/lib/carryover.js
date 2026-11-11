// Money left at the end of a period carries into the next one, after the
// savings set-aside and the money saved up for bills. A minus carries too.
//
// Nothing is stored but the setting:
//   carry.on      whether leftovers carry at all
//   carry.from    the first period whose leftover carries. Periods before it
//                 count exactly as they did in 0.8.0
//   carry.resets  periods that start at 0, whatever came before ("Start
//                 fresh"); the ones after them carry on from there
//
// The carry is worked out from history every time, so editing a closed
// period moves every later carry with it. It comes from the same walk that
// saves up for bills (walkPeriods in sinking.js): what a period can save for
// a bill depends on what was carried into it, so one loop does both.

import { walkPeriods } from "./sinking.js";

// The split itself sits beside the set-aside, where the bill walk can use it
// without importing this file. It is exported from here for everyone else.
export { splitPeriod } from "./setAside.js";

// Each closed period from where carrying starts, oldest first, with how its
// money was shared out:
//   { carriedIn, setAsideApplied, billsSaved, billsPaid, billsReleased, carriedOut }
// `billsPaid` is what bills' savings paid towards them (the Dashboard's
// "paid from fund"); `billsReleased` is what a bill's savings had left over
// when its cycle ended, back in the period's money. Only periods the budget
// has a record of are listed. Empty when carrying is off.
export function carryChain(data, today = new Date()) {
  return walkPeriods(data, today).chain;
}

// What a period starts with from the ones before it, as the walk decided it
// (a minus included, and 0 where "Start fresh" applies).
//
// Meant for the running period: the Dashboard and the forecast start from
// it. A closed period the budget has a record of gets its chain entry's
// `carriedIn`. Anything else - a period before the start, one with no
// record, one still to come - gets 0, because the walk decides only for the
// periods it records and the running one.
// Widths, in percent of `whole`, for the Dashboard's Income Breakdown bar.
// Each segment takes what is left of the bar at most, so nothing draws past
// 100% however much was spent or overspent. Empty segments are dropped.
export function barWidths(values, whole) {
  if (!(whole > 0)) return [];
  let room = 100;
  return values.map((v) => {
    const w = Math.max(0, Math.min((v / whole) * 100, room));
    room -= w;
    return w;
  });
}

export function carriedInto(data, periodKey, today = new Date()) {
  const { chain, curKey, carryOn } = walkPeriods(data, today);
  if (periodKey === curKey) return carryOn;
  return chain.get(periodKey)?.carriedIn ?? 0;
}
