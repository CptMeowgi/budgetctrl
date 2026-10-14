// How often a recurring bill or credit repeats, in whole budget periods.
//
// A recurring item lives in the template and is copied into each new period.
// Frequency only decides WHICH periods receive a copy: a yearly insurance bill
// is copied into one period in twelve. Everything that works on a period's
// contents - totals, Remaining, reminders, export - needs no change, because
// the item is simply present or absent.
//
// `every` is the number of periods between occurrences (1 = monthly) and
// `anchor` is the period key of an occurrence, from which the cycle is counted.
// Items saved before frequencies existed have neither, and stay monthly.

export const FREQUENCIES = [
  { every: 1, label: "Monthly" },
  { every: 2, label: "Every 2 months" },
  { every: 3, label: "Quarterly" },
  { every: 6, label: "Every 6 months" },
  { every: 12, label: "Yearly" },
];

// The day a recurring item falls on, from what was typed: a whole day, 1 to
// 31. A month shorter than that uses its last day.
export function dayOfMonthFrom(input) {
  const n = Math.round(Number(input));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 31) : 1;
}

export function frequencyLabel(every) {
  return (FREQUENCIES.find((f) => f.every === (every || 1)) || { label: `Every ${every} months` }).label;
}

export function everyFromLabel(label) {
  return (FREQUENCIES.find((f) => f.label === label) || FREQUENCIES[0]).every;
}

function parse(key) {
  const [y, m] = String(key).split("-").map(Number);
  return { y, m };
}

export function monthsBetween(fromKey, toKey) {
  const a = parse(fromKey);
  const b = parse(toKey);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

export function addMonths(key, n) {
  const { y, m } = parse(key);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

// Does this item occur in this period? Monthly items, and anything saved
// before frequencies existed, occur in every period. Nothing occurs before its
// anchor - a yearly bill set up to start next March must not appear today.
export function isOnCycle(item, periodKey) {
  const every = Number(item?.every) || 1;
  if (every <= 1 || !item.anchor) return true;
  const diff = monthsBetween(item.anchor, periodKey);
  return diff >= 0 && diff % every === 0;
}

// The first period at or after `fromKey` in which the item occurs.
export function nextOnCycle(item, fromKey) {
  const every = Number(item?.every) || 1;
  if (every <= 1 || !item.anchor) return fromKey;
  const diff = monthsBetween(item.anchor, fromKey);
  if (diff <= 0) return item.anchor;
  const r = diff % every;
  return r === 0 ? fromKey : addMonths(fromKey, every - r);
}

// The Repeats choices on the Recurring and Credit forms: weekly first, then
// the monthly frequencies.
export const REPEAT_OPTIONS = [
  { label: "Every week", weeks: 1 },
  { label: "Every 2 weeks", weeks: 2 },
  ...FREQUENCIES.map((f) => ({ label: f.label, months: f.every })),
];

export function repeatLabel(item) {
  if (item?.repeat === "weeks") return Number(item.every) === 2 ? "Every 2 weeks" : "Every week";
  return frequencyLabel(item?.every);
}

// The repeat settings a Recurring or Credit form saves. Weekly items carry a
// first date and no day of the month. Monthly items carry `every` and
// `anchor` only when they skip months, and nothing at all otherwise, exactly
// like items saved before frequencies existed. `values.repeats` is only on
// the form when the template is being edited; otherwise `sched` (what the
// item had) stands.
export function scheduleFromForm(values, sched, targetKey, firstDate) {
  const choice = values.repeats ? REPEAT_OPTIONS.find((o) => o.label === values.repeats) : null;
  const weeks = choice ? choice.weeks : (sched.repeat === "weeks" ? (Number(sched.every) === 2 ? 2 : 1) : undefined);
  if (weeks) {
    return { repeat: "weeks", every: weeks, startDate: values.startDate || sched.startDate || firstDate,
             dayOfMonth: undefined, anchor: undefined };
  }
  const every = choice ? choice.months : (sched.every || 1);
  return every > 1
    ? { every, anchor: values.anchor || sched.anchor || targetKey, repeat: undefined, startDate: undefined }
    : { every: undefined, anchor: undefined, repeat: undefined, startDate: undefined };
}
