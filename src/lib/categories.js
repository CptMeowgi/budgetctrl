// Category maintenance: rename, merge, restyle and delete, as pure functions
// over the whole data document. Nothing here mutates its input.
//
// A category name is stored on every entry that uses it, not as a reference to
// an id, so renaming one means rewriting every entry - across every period and
// the recurring template - or those entries quietly fall back to "Uncategorized"
// on screen while still carrying the old name on disk.

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
const sameName = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

function kindOf(kind) {
  const k = CATEGORY_KINDS[kind];
  if (!k) throw new Error(`Unknown category kind: ${kind}`);
  return k;
}

// Rewrite the category on every entry and template item matching `from`.
function reassign(data, k, from, to) {
  const swap = (e) => (sameName(e.category, from) ? { ...e, category: to } : e);
  const months = {};
  for (const [key, m] of Object.entries(data.months || {})) {
    const next = { ...m };
    for (const list of k.entryLists) {
      if (Array.isArray(m[list])) next[list] = m[list].map(swap);
    }
    months[key] = next;
  }
  return {
    ...data,
    months,
    [k.template]: (data[k.template] || []).map(swap),
  };
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
      for (const e of m[list] || []) if (sameName(e.category, name)) entries++;
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
  if (!target) throw new Error("A category needs a name.");
  if (isFallback(kind, from)) throw new Error(`"${k.fallback}" cannot be renamed.`);

  const list = data[k.list] || [];
  const source = list.find((c) => sameName(c.name, from));
  if (!source) throw new Error(`No category named "${from}".`);

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

// Delete a category, moving anything that used it to `moveTo` (the fallback by
// default). The fallback itself cannot be deleted - it is what everything lands
// in - and is recreated if it has somehow gone missing.
export function deleteCategory(data, kind, name, moveTo) {
  const k = kindOf(kind);
  if (isFallback(kind, name)) throw new Error(`"${k.fallback}" cannot be deleted.`);
  const dest = norm(moveTo) || k.fallback;
  if (sameName(dest, name)) throw new Error("Cannot move entries into the category being deleted.");

  const list = data[k.list] || [];
  const victim = list.find((c) => sameName(c.name, name));
  if (!victim) throw new Error(`No category named "${name}".`);

  let nextList = list.filter((c) => c !== victim);
  const destEntry = nextList.find((c) => sameName(c.name, dest));
  if (!destEntry) {
    nextList = [...nextList, { name: dest, color: "#9ca3af", icon: "·" }];
  }
  const destName = destEntry ? destEntry.name : dest;

  return { ...reassign(data, k, victim.name, destName), [k.list]: nextList };
}
