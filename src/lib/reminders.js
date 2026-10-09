// Which bills a reminder should mention. Pure: given the data and a moment in
// time, returns the due list. The Due Soon view and the notification both call
// this, so the screen and the toast can never disagree.

import { periodKeyFor, recurringDateInPeriod, isoDay, startOfDay, daysBetween } from "./periods.js";

// How far back a notification will chase an unpaid bill. It exists to stop a
// forgotten entry nagging forever - NOT to hide it. The app itself passes
// Infinity, because an unpaid bill is money owed however old it is, and
// quietly dropping it is worse than repeating it.
export const OVERDUE_GRACE_DAYS = 30;

// A payment is settled when it has been ticked off, or when it pays itself and
// its due date has passed. Direct debits and card-on-file subscriptions leave
// the account without anyone touching the app, so demanding a manual tick made
// them look permanently overdue.
export function upcomingSettled(u, today) {
  if (u.paid) return true;
  if (!u.autoPay) return false;
  const due = new Date(u.dueDate);
  return !isNaN(due.getTime()) && startOfDay(due) <= startOfDay(today || new Date());
}

export function collectDueBills(data, now, leadDays, graceDays = OVERDUE_GRACE_DAYS) {
  const cutoffDay = data.cutoffDay || 1;
  const key = periodKeyFor(now, cutoffDay);
  const out = [];

  for (const r of (data.months?.[key]?.recurring || [])) {
    if (r.dayOfMonth == null) continue;
    // A bill that pays itself needs no warning - that is the point of the flag.
    if (r.autoPay) continue;
    const due = recurringDateInPeriod(r.dayOfMonth, key, cutoffDay);
    const inDays = daysBetween(now, due);
    // Recurring items carry no paid flag - they count as spent once the day
    // passes - so only the run-up to the date is worth announcing.
    if (inDays >= 0 && inDays <= leadDays) {
      out.push({ id: `r-${r.id}-${key}`, kind: "recurring", entryId: r.id, periodKey: key,
                 name: r.name, amount: r.amount || 0, inDays, dueISO: isoDay(due) });
    }
  }

  // Unpaid one-offs are scanned across every period, not just the current one:
  // an item left unpaid last month stays filed under last month, and that is
  // precisely the case most worth surfacing.
  for (const [mk, m] of Object.entries(data.months || {})) {
    for (const u of (m.upcoming || [])) {
      if (u.paid || u.autoPay) continue;
      const due = new Date(u.dueDate);
      if (isNaN(due.getTime())) continue;
      const inDays = daysBetween(now, due);
      if (inDays <= leadDays && inDays >= -graceDays) {
        out.push({ id: `u-${u.id}`, kind: "upcoming", entryId: u.id, periodKey: mk,
                   name: u.name, amount: u.amount || 0, inDays, dueISO: isoDay(due) });
      }
    }
  }

  return out.sort((a, b) => a.inDays - b.inDays);
}

export function whenLabel(inDays) {
  if (inDays < 0) return `${-inDays}d overdue`;
  if (inDays === 0) return "due today";
  if (inDays === 1) return "due tomorrow";
  return `due in ${inDays}d`;
}
