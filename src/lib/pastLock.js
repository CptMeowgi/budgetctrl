// Locking past periods (optional): a period that ended more than
// `data.lockPastMonths` months ago can't be changed until it's unlocked, so a
// stray click can't rewrite last year's figures. Off (0 or unset) leaves
// History fully editable, as it always was.

export const LOCK_CHOICES = [0, 1, 3, 6, 12];

export function isPeriodLocked(data, cal, key, today = new Date()) {
  const months = Number(data?.lockPastMonths) || 0;
  if (!months || !key || key >= cal.current(today)) return false;
  const end = cal.range(key).end;
  if (isNaN(end.getTime())) return false;
  const limit = new Date(today.getFullYear(), today.getMonth() - months, today.getDate());
  return end < limit;
}
