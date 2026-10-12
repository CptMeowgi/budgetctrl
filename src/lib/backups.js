// Naming backups, and keeping writes to the budget file in order.

const pad = (n) => String(n).padStart(2, "0");

// budget-ctrl-2026-10-11-1432-before-import.json: local date and time, then
// why it was taken. The time keeps two snapshots on one day from overwriting
// each other, and names sort in the order they were taken.
export function backupName(at, tag) {
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `budget-ctrl-${day}-${pad(at.getHours())}${pad(at.getMinutes())}-${tag}.json`;
}

// Back to { date, time, tag }. Versions before 0.5.2 wrote no time, and
// called the daily one budget-ctrl-YYYY-MM-DD.json.
export function parseBackupName(name) {
  const m = /^budget-ctrl-(\d{4}-\d{2}-\d{2})(?:-(\d{2})(\d{2})(?=-|\.json$))?(?:-(.+))?\.json$/.exec(name);
  if (!m) return null;
  return { date: m[1], time: m[2] ? `${m[2]}:${m[3]}` : null, tag: m[4] || "daily" };
}

// Whether the budget file's text can be opened at all: a JSON object. What
// shape it is in is the model's business - migrate() still reads the oldest
// format, which has no months table - so this only tells a damaged file (cut
// short, emptied, overwritten with something else) from a whole one.
export function isBudgetText(text) {
  if (!text || !text.trim()) return false;
  try {
    const parsed = JSON.parse(text);
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

// Wraps an async function so calls run one at a time, in the order they were
// made. Saving writes the whole budget file; two writes in flight at once can
// finish in either order, and an older one finishing last would win.
export function serial(fn) {
  let last = Promise.resolve();
  return (...args) => {
    const run = last.then(() => fn(...args));
    last = run.catch(() => {});
    return run;
  };
}
