// What the app does around a save to the budget store (lib/budgetStore.js):
// the decisions only, so they can be tested. App.jsx does the showing.

// A doc made fresh is the open budget's. An edit keeps the stamp of the doc
// it was made from, through every spread. Null for a doc of a budget that
// isn't open any more: nothing to show or save.
export function stampFor(next, open) {
  const doc = next.budgetOf ? next : { ...next, budgetOf: open };
  return doc.budgetOf === open ? doc : null;
}

// Whether an undo or redo snapshot can only go back as a whole budget: it is
// from another generation than the open budget's, as one from before a
// reset, an import or a restore is. `current` is the store's doc for the
// open budget.
export function needsReplace(snapshot, current) {
  return !!current && snapshot.budgetGen !== current.budgetGen;
}

// After the store answered a save of `doc`. `stored` is the doc as stored,
// false when the store refused it, or null when the write failed; `replaced`
// says it was a whole budget; `shown` is the doc on screen now and `held` the
// store's doc for the open budget now. Gives the doc to show (null to leave
// the screen as it is) and whether to say the change wasn't saved.
//
// A doc taken comes back carrying its budget's generation, which every
// later edit must carry too, so it is shown in place of the one sent, unless
// a newer edit has been shown since (made from it, that carries the
// generation already). A whole budget is always shown: nothing made while it
// was on its way can be saved over it. A doc refused, or a write that failed,
// leaves the open budget as the store holds it; only a refusal is said, as a
// failed write is kept by the store and written by the next save that works.
export function afterSave({ doc, stored, replaced = false, shown, held }) {
  const latest = replaced || shown === doc;
  if (stored) return { show: latest && stored !== shown ? stored : null, refused: false };
  return { show: latest && held && held !== shown ? held : null, refused: stored === false };
}
