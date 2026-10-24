// Changing several entries at once, mostly to tidy up after a big statement
// import. Each returns the new list and what it did, so one save (one undo
// step) covers the whole change.

import { isSplit } from "./splits.js";

// File the selected entries under one category. A split payment is left as
// it is: one category would wipe out how it was divided.
export function bulkCategory(entries, ids, category) {
  let changed = 0;
  let skipped = 0;
  const out = (entries || []).map((e) => {
    if (!ids.has(e.id)) return e;
    if (isSplit(e)) { skipped++; return e; }
    if (e.category === category) return e;
    changed++;
    return { ...e, category };
  });
  return { entries: out, changed, skipped };
}

export function bulkDelete(entries, ids) {
  const out = (entries || []).filter((e) => !ids.has(e.id));
  return { entries: out, removed: (entries || []).length - out.length };
}
