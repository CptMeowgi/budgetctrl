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

// How a period's money is shared out: the set-aside first, then the bills
// being saved up for from what's left, and the rest (a minus too) carries
// into the next period. With nothing carried in, it is exactly the split the
// Dashboard made in 0.8.0. The bill walk in sinking.js uses it too, which is
// why it lives here and not in carryover.js (that would import it back).
//
// `billsReleased` is what a bill's savings had left once its cycle ended (it
// cost less, or wasn't paid): money back in the period's hands. It is kept
// apart from `paidFromFund`, which stays what a fund paid towards a bill.
export function splitPeriod({ carriedIn = 0, income = 0, spent = 0, paidFromFund = 0, billsReleased = 0, setAside = 0, billsWanted = 0 }) {
  const available = carriedIn + income - spent + paidFromFund + billsReleased;
  const setAsideApplied = Math.min(setAside, Math.max(0, available));
  const billsSaved = Math.min(billsWanted, Math.max(0, available - setAsideApplied));
  return { available, setAsideApplied, billsSaved, carriedOut: available - setAsideApplied - billsSaved };
}
