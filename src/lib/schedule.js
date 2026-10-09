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
