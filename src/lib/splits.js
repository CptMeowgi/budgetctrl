// One payment, several categories: a supermarket receipt that is part food,
// part household. The expense keeps its total `amount`, and `splits` says how
// it divides: [{ category, amount }], adding up to the total.
//
// `category` on a split expense is its largest part, so anything that shows a
// single category still shows something sensible. Anything that adds up
// spending by category must go through splitParts().

export const SPLIT_LABEL = "Split";

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function isSplit(entry) {
  return Array.isArray(entry?.splits) && entry.splits.length > 1;
}

// The parts an entry's spending divides into: its splits, or the whole amount
// in its one category.
export function splitParts(entry) {
  if (isSplit(entry)) return entry.splits;
  return [{ category: entry?.category, amount: entry?.amount || 0 }];
}

// What is left to assign: the total less the parts so far.
export function remainder(amount, parts) {
  const left = cents(cents(amount) - (parts || []).reduce((a, p) => a + cents(p.amount), 0));
  // Rounding 0.3 - (0.1 + 0.2) gives -0, which would show as "-0.00".
  return left === 0 ? 0 : left;
}

// Tidy a split as typed into what is stored: whole cents, empty parts dropped,
// parts in the same category merged, largest first. A split that no longer
// has two parts is just a category.
export function cleanSplit(amount, parts) {
  const merged = new Map();
  for (const p of parts || []) {
    const a = cents(p.amount);
    if (!(a > 0)) continue;
    const c = (p.category || "").trim() || "Uncategorized";
    merged.set(c, cents((merged.get(c) || 0) + a));
  }
  const list = [...merged.entries()].map(([category, amt]) => ({ category, amount: amt })).sort((a, b) => b.amount - a.amount);
  const left = remainder(amount, list);
  if (Math.abs(left) >= 0.005) {
    return { error: left > 0 ? `${left.toFixed(2)} still to assign` : `${(-left).toFixed(2)} more than the total` };
  }
  if (list.length < 2) return { category: list[0]?.category || "Uncategorized", splits: undefined };
  return { category: list[0].category, splits: list };
}

// Rename a category inside an entry's splits, merging parts that now share
// one, and keep the entry's headline category in step.
export function renameInSplits(entry, sameName, to) {
  if (!isSplit(entry)) return entry;
  if (!entry.splits.some((p) => sameName(p.category))) return entry;
  const renamed = entry.splits.map((p) => (sameName(p.category) ? { ...p, category: to } : p));
  const { category, splits } = cleanSplit(entry.amount, renamed);
  const out = { ...entry, category };
  if (splits) out.splits = splits; else delete out.splits;
  return out;
}
