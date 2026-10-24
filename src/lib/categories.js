// Category maintenance: rename, merge, restyle and delete, as pure functions
// over the whole data document. Nothing here mutates its input.
//
// A category name is stored on every entry that uses it, not as a reference to
// an id, so renaming one means rewriting every entry - across every period and
// the recurring template - or those entries quietly fall back to "Uncategorized"
// on screen while still carrying the old name on disk.

import { isSplit, renameInSplits } from "./splits.js";

export const CATEGORY_KINDS = {
  spend: {
    list: "categories",
    fallback: "Uncategorized",
    entryLists: ["expenses", "recurring", "upcoming"],
    template: "recurringTemplate",
  },
  credit: {
    list: "creditCategories",
    fallback: "Other",
    entryLists: ["credits"],
    template: "creditTemplate",
  },
};

const norm = (s) => (s || "").trim();

// Errors carry their wording as a template and its values, so the screen can
// show them in the reader's language; the message itself stays English.
function fail(template, vars = {}) {
  const err = new Error(template.replace(/\{(\w+)\}/g, (_, k) => vars[k]));
  err.key = template;
  err.vars = vars;
  return err;
}
const sameName = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

function kindOf(kind) {
  const k = CATEGORY_KINDS[kind];
  if (!k) throw new Error(`Unknown category kind: ${kind}`);
  return k;
}

// Rewrite the category on every entry and template item matching `from` -
// including the parts of a split receipt - and on the import rules, which
// would otherwise go on filing new imports under a name that is gone.
function reassign(data, k, from, to) {
  const swap = (e) => {
    if (isSplit(e)) return renameInSplits(e, (c) => sameName(c, from), to);
    return sameName(e.category, from) ? { ...e, category: to } : e;
  };
  const months = {};
  for (const [key, m] of Object.entries(data.months || {})) {
    const next = { ...m };
    for (const list of k.entryLists) {
      if (Array.isArray(m[list])) next[list] = m[list].map(swap);
    }
    months[key] = next;
  }
  const out = { ...data, months, [k.template]: (data[k.template] || []).map(swap) };
  // A rule names a category without saying which kind. When the other kind
  // has a category of the same name too, the rule may mean that one, so it is
  // left alone.
  const other = k.list === "categories" ? "creditCategories" : "categories";
  const ambiguous = (data[other] || []).some((c) => sameName(c.name, from));
  if (Array.isArray(data.importRules) && !ambiguous) {
    out.importRules = data.importRules.map((r) => (sameName(r.category, from) ? { ...r, category: to } : r));
  }
  return out;
}

export function isFallback(kind, name) {
  return sameName(name, kindOf(kind).fallback);
}

// How many period entries and template items use a category. Template items are
// counted separately because deleting a category they use changes what every
// future period is created with, not just what is already recorded.
export function countUsage(data, kind, name) {
  const k = kindOf(kind);
  let entries = 0;
  for (const m of Object.values(data.months || {})) {
    for (const list of k.entryLists) {
      for (const e of m[list] || []) {
        const uses = isSplit(e) ? e.splits.some((p) => sameName(p.category, name)) : sameName(e.category, name);
        if (uses) entries++;
      }
    }
  }
  const templates = (data[k.template] || []).filter((e) => sameName(e.category, name)).length;
  return { entries, templates };
}

// Rename `from` to `to`. If `to` already names a different category, the two are
// merged: `from` disappears, its entries move across, and the target keeps its
// own colour and icon. A budget set only on the source survives the merge -
// with its history and rollover setting - rather than being silently dropped.
function adoptBudget(target, source) {
  const out = { ...target, cap: source.cap };
  if (source.capHistory) out.capHistory = source.capHistory;
  if (source.rollover) out.rollover = source.rollover;
  return out;
}

export function renameCategory(data, kind, from, to) {
  const k = kindOf(kind);
  const target = norm(to);
  if (!target) throw fail("A category needs a name.");
  if (isFallback(kind, from)) throw fail('"{name}" cannot be renamed.', { name: k.fallback });

  const list = data[k.list] || [];
  const source = list.find((c) => sameName(c.name, from));
  if (!source) throw fail('No category named "{name}".', { name: from });

  const existing = list.find((c) => sameName(c.name, target) && c !== source);

  let nextList;
  let finalName;
  if (existing) {
    finalName = existing.name;
    nextList = list
      .filter((c) => c !== source)
      .map((c) => (c === existing && c.cap == null && source.cap != null ? adoptBudget(c, source) : c));
  } else {
    finalName = target;
    nextList = list.map((c) => (c === source ? { ...c, name: target } : c));
  }

  return { ...reassign(data, k, source.name, finalName), [k.list]: nextList };
}

export function restyleCategory(data, kind, name, style) {
  const k = kindOf(kind);
  const patch = {};
  if (style.color) patch.color = style.color;
  if (style.icon) patch.icon = style.icon;
  return {
    ...data,
    [k.list]: (data[k.list] || []).map((c) => (sameName(c.name, name) ? { ...c, ...patch } : c)),
  };
}

// Leave a spending category out of Reports, or put it back: for a one-off big
// purchase, or expenses paid back later. Budgets still count it.
export function setHideFromReports(data, name, hide) {
  return {
    ...data,
    categories: (data.categories || []).map((c) => {
      if (!sameName(c.name, name)) return c;
      if (hide) return { ...c, hideFromReports: true };
      const { hideFromReports: _gone, ...rest } = c;
      return rest;
    }),
  };
}

// Delete a category, moving anything that used it to `moveTo` (the fallback by
// default). The fallback itself cannot be deleted - it is what everything lands
// in - and is recreated if it has somehow gone missing.
export function deleteCategory(data, kind, name, moveTo) {
  const k = kindOf(kind);
  if (isFallback(kind, name)) throw fail('"{name}" cannot be deleted.', { name: k.fallback });
  const dest = norm(moveTo) || k.fallback;
  if (sameName(dest, name)) throw fail("Cannot move entries into the category being deleted.");

  const list = data[k.list] || [];
  const victim = list.find((c) => sameName(c.name, name));
  if (!victim) throw fail('No category named "{name}".', { name });

  let nextList = list.filter((c) => c !== victim);
  const destEntry = nextList.find((c) => sameName(c.name, dest));
  if (!destEntry) {
    nextList = [...nextList, { name: dest, color: "#9ca3af", icon: "·" }];
  }
  const destName = destEntry ? destEntry.name : dest;

  return { ...reassign(data, k, victim.name, destName), [k.list]: nextList };
}
