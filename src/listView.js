

export function toggleSort(sorts, col, shiftKey) {
  const arr = sorts || [];
  const idx = arr.findIndex((s) => s.col === col);
  if (shiftKey) {
    if (idx === -1) return [...arr, { col, dir: "asc" }];
    const cur = arr[idx];
    if (cur.dir === "asc") {
      const next = [...arr];
      next[idx] = { col, dir: "desc" };
      return next;
    }
    return arr.filter((_, i) => i !== idx);
  }
  if (arr.length === 1 && arr[0].col === col) {
    if (arr[0].dir === "asc") return [{ col, dir: "desc" }];
    return [];
  }
  return [{ col, dir: "asc" }];
}

export function filterAndSort(arr, view) {
  let out = arr;
  if (view.search) {
    const q = view.search.toLowerCase();
    // Name, category and note, so "dentist" finds an entry named "Dr. Kowalski"
    // whose note says dentist.
    out = out.filter((x) => [x.name, x.category, x.note].some((f) => (f || "").toLowerCase().includes(q)));
  }
  const sorts = view.sorts || [];
  if (sorts.length > 0) {
    out = [...out].sort((a, b) => {
      for (const { col, dir } of sorts) {
        const av = a[col], bv = b[col];
        const cmp = (typeof av === "string" && typeof bv === "string")
          ? av.localeCompare(bv)
          : (av < bv ? -1 : av > bv ? 1 : 0);
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }
  return out;
}

// Column sets shared by the live tabs and the History detail view. History
// passes no sorts/onSort, which TableHeader handles by leaving those columns
// unclickable - so one definition serves both.
export const ENTRY_COLUMNS = {
  expenses: [
    { label: "NAME", flex: 2, sortKey: "name" },
    { label: "CATEGORY", flex: 1.2, sortKey: "category" },
    { label: "DATE", flex: 1, sortKey: "date" },
    { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" },
    { label: "", flex: 0.6, align: "center" },
  ],
  recurring: [
    { label: "NAME", flex: 2, sortKey: "name" },
    { label: "CATEGORY", flex: 1.2, sortKey: "category" },
    { label: "DAY", flex: 0.5, align: "center", sortKey: "dayOfMonth" },
    { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" },
    { label: "", flex: 0.6, align: "center" },
  ],
  upcoming: [
    { label: "", flex: 0.3 },
    { label: "NAME", flex: 2, sortKey: "name" },
    { label: "CATEGORY", flex: 1.2, sortKey: "category" },
    { label: "DUE DATE", flex: 1, sortKey: "dueDate" },
    { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" },
    { label: "STATUS", flex: 0.7, align: "center" },
    { label: "", flex: 0.6, align: "center" },
  ],
};
