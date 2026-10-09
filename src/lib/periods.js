// Budget-period arithmetic. A period is keyed "YYYY-MM" by the calendar month it
// STARTS in: with a cutoff day of 10, period "2026-09" runs 10 Sep - 9 Oct, and
// cutoff 1 collapses to plain calendar months. Keying by start month means
// changing the cutoff never invalidates existing keys.
//
// Moved verbatim out of App.jsx so it can be tested. Nearly every serious bug in
// this app's history has lived in this arithmetic - day-31 bills never firing in
// short months, UTC dates landing on the wrong day, recurring items counted
// before they were due - so it is the code that most needs a safety net.

export function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonthKey() {
  return monthKey(new Date());
}

export function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function daysInCalMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

// A budget period is keyed by the calendar month it STARTS in. With a cutoff of
// 10, period "2026-09" runs 10 Sep - 9 Oct. Cutoff 1 collapses to calendar months.
export function periodKeyFor(date, cutoffDay) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  let y = d.getFullYear();
  let m = d.getMonth();
  if (cutoffDay > 1 && d.getDate() < cutoffDay) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function currentPeriodKey(cutoffDay) {
  return periodKeyFor(new Date(), cutoffDay || 1);
}

export function periodRange(periodKey, cutoffDay) {
  const [y, m] = periodKey.split("-").map(Number);
  const cd = cutoffDay || 1;
  const start = new Date(y, m - 1, Math.min(cd, daysInCalMonth(y, m)));
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const endExclusive = new Date(nextY, nextM - 1, Math.min(cd, daysInCalMonth(nextY, nextM)));
  return { start, end: new Date(endExclusive.getTime() - 86400000) };
}

export function periodLabel(periodKey, cutoffDay) {
  const primary = monthLabel(periodKey);
  if (!cutoffDay || cutoffDay <= 1) return { primary, range: null };
  const { start, end } = periodRange(periodKey, cutoffDay);
  const short = (d) => d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  return { primary, range: `${short(start)} – ${short(end)}` };
}

// Resolves which actual date inside the period a given dayOfMonth lands on.
// With cutoff 10 and period 2026-09: day 15 -> 15 Sep; day 5 -> 5 Oct.
export function recurringDateInPeriod(dayOfMonth, periodKey, cutoffDay) {
  const { start, end } = periodRange(periodKey, cutoffDay);
  const day = Number(dayOfMonth || 1);
  const tryIn = (y, m1) => new Date(y, m1 - 1, Math.min(day, daysInCalMonth(y, m1)));
  let c = tryIn(start.getFullYear(), start.getMonth() + 1);
  if (c >= start && c <= end) return c;
  c = tryIn(end.getFullYear(), end.getMonth() + 1);
  if (c >= start && c <= end) return c;
  return start;
}

export function isRecurringDue(r, periodKey, today, cutoffDay) {
  const { start, end } = periodRange(periodKey, cutoffDay || 1);
  if (today > end) return true;
  if (today < start) return false;
  return today >= recurringDateInPeriod(r.dayOfMonth, periodKey, cutoffDay || 1);
}

// Local-calendar day. Never toISOString() here - that shifts to UTC and lands
// on the wrong day for anyone east of Greenwich.
export function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
}
