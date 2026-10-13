// Budget-period arithmetic. A period is keyed "YYYY-MM" by the calendar month it
// STARTS in: with a cutoff day of 10, period "2026-09" runs 10 Sep - 9 Oct, and
// cutoff 1 collapses to plain calendar months. Keying by start month means
// changing the cutoff never invalidates existing keys.
//
// Moved verbatim out of App.jsx so it can be tested. Nearly every serious bug in
// this app's history has lived in this arithmetic - day-31 bills never firing in
// short months, UTC dates landing on the wrong day, recurring items counted
// before they were due - so it is the code that most needs a safety net.

// A date as the app stores it - "YYYY-MM-DD", a calendar day - read as that
// day where you are. new Date("2026-10-25") reads midnight in London, which is
// still the 24th anywhere west of it. Dates and full timestamps pass through.
export function parseDay(value) {
  if (value instanceof Date) return value;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

export function monthKey(date) {
  const d = parseDay(date);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonthKey() {
  return monthKey(new Date());
}

// The language month names are written in. English unless the app says
// otherwise; tests rely on the default.
let labelLocale = "en-US";
export function setLabelLocale(locale) {
  labelLocale = locale || "en-US";
}

export function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString(labelLocale, { month: "long", year: "numeric" });
  // Polish gives "październik 2026"; as a heading it wants a capital.
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function daysInCalMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

// A budget period is keyed by the calendar month it STARTS in. With a cutoff of
// 10, period "2026-09" runs 10 Sep - 9 Oct. Cutoff 1 collapses to calendar months.
export function periodKeyFor(date, cutoffDay) {
  const d = parseDay(date);
  if (isNaN(d.getTime())) return null;
  let y = d.getFullYear();
  let m = d.getMonth();
  // The payday as this month has it: the 31st is the 30th in April and the
  // 28th in February, exactly as periodRange starts the period.
  const payday = Math.min(cutoffDay || 1, daysInCalMonth(y, m + 1));
  if (payday > 1 && d.getDate() < payday) {
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
  // The day before the next period starts, by the calendar. Subtracting 24
  // hours instead ended a period a day early when the clocks went forward
  // inside that last day (a 23-hour day). Day 0 is the previous month's last.
  const end = new Date(nextY, nextM - 1, Math.min(cd, daysInCalMonth(nextY, nextM)) - 1);
  return { start, end };
}

export function periodLabel(periodKey, cutoffDay) {
  const primary = monthLabel(periodKey);
  if (!cutoffDay || cutoffDay <= 1) return { primary, range: null };
  const { start, end } = periodRange(periodKey, cutoffDay);
  const short = (d) => d.toLocaleDateString(labelLocale, { day: "numeric", month: "short" });
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

// The date a new entry starts with: today, when it is going into the running
// period; otherwise that period's first day. The first of the calendar month
// was wrong with a payday start - 1 September is not in the period that
// begins on 25 August.
export function newEntryDate(periodKey, cutoffDay, today) {
  if (periodKeyFor(today, cutoffDay || 1) === periodKey) return isoDay(today);
  return isoDay(periodRange(periodKey, cutoffDay).start);
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
