// Category groups: Bills, Everyday, Fun... A spending category names its
// group (`group`), and `data.categoryGroups` keeps the order they're shown
// in. A budget without groups shows its categories as one list, as before.

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// The groups in use: in the order kept, then any others alphabetically.
export function groupNames(data) {
  const used = new Set((data.categories || []).map((c) => clean(c.group)).filter(Boolean));
  const kept = (data.categoryGroups || []).filter((g) => used.has(g));
  const rest = [...used].filter((g) => !kept.includes(g)).sort((a, b) => a.localeCompare(b));
  return [...kept, ...rest];
}

// Rows named after categories, sorted into their groups: [{ group, rows }],
// the rows in the order given, groups in their order, the ungrouped last
// (group null). Without groups, one plain list.
export function groupRows(rows, data) {
  const names = groupNames(data);
  if (!names.length) return [{ group: null, rows }];
  const groupOf = new Map((data.categories || []).map((c) => [c.name, clean(c.group) || null]));
  const sections = [...names, null].map((group) => ({ group, rows: rows.filter((r) => (groupOf.get(r.name) ?? null) === group) }));
  return sections.filter((s) => s.rows.length);
}

// A group's line in a report: its categories added up.
export function groupTotals(rows) {
  const n = Math.max(0, ...rows.map((r) => r.perPeriod?.length || 0));
  return {
    total: rows.reduce((a, r) => a + (r.total || 0), 0),
    average: rows.reduce((a, r) => a + (r.average || 0), 0),
    perPeriod: Array.from({ length: n }, (_, i) => rows.reduce((a, r) => a + (r.perPeriod?.[i] || 0), 0)),
  };
}

// Put a spending category in a group, or take it out with an empty name. A
// group already there is joined under its own spelling.
export function setCategoryGroup(data, name, group) {
  const wanted = clean(group);
  const existing = groupNames(data).concat(data.categoryGroups || []).find((g) => g.toLowerCase() === wanted.toLowerCase());
  const final = existing || wanted;
  const categories = (data.categories || []).map((c) => {
    if (c.name !== name) return c;
    if (!final) { const { group: _gone, ...rest } = c; return rest; }
    return { ...c, group: final };
  });
  const order = data.categoryGroups || groupNames(data);
  const categoryGroups = final && !order.includes(final) ? [...order, final] : order;
  return { ...data, categories, categoryGroups };
}
