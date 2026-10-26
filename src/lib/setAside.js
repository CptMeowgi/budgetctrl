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
