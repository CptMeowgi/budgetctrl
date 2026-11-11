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
//   { carriedIn, setAsideApplied, billsSaved, billsPaid, carriedOut }
// Only periods the budget has a record of are listed. Empty when carrying is
// off.
export function carryChain(data, today = new Date()) {
  return walkPeriods(data, today).chain;
}

// What a period starts with from the one before: the carry out of the latest
// recorded period before it. A period with no record in between passes it on
// unchanged. Nothing before the start, with carrying off, or at a period
// listed to start fresh (or after one with no record of its own).
export function carriedInto(data, periodKey, today = new Date()) {
  const chain = carryChain(data, today);
  let last = null;
  for (const k of chain.keys()) if (k < periodKey) last = k;
  if (last == null) return 0;
  const resets = Array.isArray(data.carry.resets) ? data.carry.resets : [];
  if (resets.some((r) => r > last && r <= periodKey)) return 0;
  return chain.get(last).carriedOut;
}
