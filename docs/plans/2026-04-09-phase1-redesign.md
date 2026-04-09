# Phase 1 — Redesign, Categories, Wider Layout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply a Revolut-inspired light theme, widen the layout, add ad-hoc categories to every entry (expense/recurring/upcoming) with a suggestions dropdown, and include unpaid upcoming payments in the "remaining" calculation.

**Architecture:** Single-file React app (`src/App.jsx`). We'll introduce a CSS-variable-based theme at the top of `<body>` via a style tag in the render tree (keeps the "no CSS files" constraint of the current codebase), rewrite the inline-style object `s` to consume those variables, add a `categories` top-level data field, add a `CategoryPicker` component, and update the three modals + all tables/cards to use it. The migration already established in prior tasks is extended to backfill `category: "Uncategorized"`.

**Tech Stack:** React 19, Vite, localStorage via `window.storage` shim. No test framework — verification via Claude Preview MCP.

**Reference:** `docs/plans/2026-04-09-phase1-redesign-design.md`

**Conventions:**
- No git commits (repo is not under version control).
- Preview server running on port 5173 (already started earlier in the session — if absent, use `preview_start` with the `budget-ctrl` config from `.claude/launch.json`).
- Single file of interest: `src/App.jsx`.
- All tasks end with a preview-based verification step.

---

### Task 1: Theme tokens and base styles

**Files:**
- Modify: `src/App.jsx` — replace the `s` style object and add a global style tag

**Step 1: Add theme constants**

Near the top of `src/App.jsx`, right after the `import { useState, ... }` line, add:

```js
const THEME = {
  bg: "#f4f5f7",
  surface: "#ffffff",
  border: "#e5e7eb",
  text: "#0c0d12",
  textMuted: "#6b7280",
  textFaint: "#9ca3af",
  accent: "#0066ff",
  accentSoft: "rgba(0,102,255,0.08)",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  shadowCard: "0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)",
};

const CATEGORY_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#0066ff", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const CATEGORY_ICONS = ["🍔", "🚗", "🛍️", "📄", "🎮", "💊", "💰", "🏠", "✈️", "🎁", "☕", "📱"];
const UNCATEGORIZED = { name: "Uncategorized", color: "#9ca3af", icon: "·" };
```

**Step 2: Rewrite the `s` style object (bottom of file)**

Find the `const s = { ... };` object (~line 540 after the history tasks). Replace the ENTIRE object with:

```js
const s = {
  shell: { display: "flex", height: "100vh", background: THEME.bg, color: THEME.text, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" },
  sidebar: { width: 240, minWidth: 240, background: THEME.surface, borderRight: `1px solid ${THEME.border}`, display: "flex", flexDirection: "column", height: "100vh" },
  logo: { padding: "28px 24px 24px", borderBottom: `1px solid ${THEME.border}` },
  nav: { padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4, flex: 1 },
  navItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: "none", background: "transparent", color: THEME.textMuted, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", textAlign: "left", width: "100%" },
  navItemActive: { background: THEME.accentSoft, color: THEME.accent },
  badge: { background: THEME.warning, color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 999, padding: "1px 7px", marginLeft: "auto" },
  sidebarIncome: { padding: "16px 20px", borderTop: `1px solid ${THEME.border}` },
  incomeInput: { background: THEME.bg, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 12px", color: THEME.success, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 16, width: "100%", textAlign: "right", outline: "none", boxSizing: "border-box" },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: THEME.bg },
  topbar: { padding: "24px 36px 20px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, background: THEME.surface },
  content: { flex: 1, overflow: "auto", padding: 36 },
  contentInner: { maxWidth: 1400, margin: "0 auto" },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 },
  statCard: { background: THEME.surface, borderRadius: 16, padding: 20, border: `1px solid ${THEME.border}`, boxShadow: THEME.shadowCard },
  dashGrid: { display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 },
  card: { background: THEME.surface, borderRadius: 16, padding: 24, border: `1px solid ${THEME.border}`, boxShadow: THEME.shadowCard },
  cardTitle: { fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2, color: THEME.textMuted, fontWeight: 700 },
  linkBtn: { background: "none", border: "none", color: THEME.accent, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600 },
  breakdownBar: { display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: THEME.bg, marginTop: 12 },
  tableHeader: { display: "flex", padding: "12px 16px", borderBottom: `1px solid ${THEME.border}`, marginTop: 16, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: THEME.textFaint, fontWeight: 700 },
  tableRow: { display: "flex", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${THEME.border}`, fontSize: 14 },
  miniRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${THEME.border}` },
  addBtn: { background: THEME.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  delBtn: { background: "none", border: "none", color: THEME.textFaint, cursor: "pointer", fontSize: 14, padding: "4px 8px" },
  empty: { textAlign: "center", color: THEME.textFaint, padding: "60px 20px", fontSize: 14 },
  emptySmall: { textAlign: "center", color: THEME.textFaint, padding: "24px 0", fontSize: 13 },
  overlay: { position: "fixed", inset: 0, background: "rgba(12,13,18,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modal: { background: THEME.surface, borderRadius: 16, padding: 28, width: "100%", maxWidth: 460, border: `1px solid ${THEME.border}`, boxShadow: "0 20px 40px rgba(0,0,0,0.12)" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  closeBtn: { background: "none", border: "none", color: THEME.textFaint, fontSize: 20, cursor: "pointer" },
  input: { width: "100%", background: THEME.bg, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "11px 14px", color: THEME.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" },
  saveBtn: { width: "100%", background: THEME.accent, color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 700, fontSize: 14, cursor: "pointer", marginTop: 8, fontFamily: "'DM Sans', sans-serif" },
  catPill: { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 4px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  catDot: { width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 },
  suggestBox: { position: "absolute", top: "100%", left: 0, right: 0, background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 10, boxShadow: THEME.shadowCard, zIndex: 10, maxHeight: 200, overflow: "auto", marginTop: 4 },
  suggestItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", fontSize: 14 },
};
```

**Step 3: Update the sidebar logo color styles**

Find the logo div in the App render (inside `<aside style={s.sidebar}>`):

```jsx
<div style={s.logo}>
  <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5 }}>BUDGET</div>
  <div style={{ fontSize: 10, letterSpacing: 3, color: "#818cf8", fontWeight: 700 }}>CTRL</div>
</div>
```

Change the `color: "#818cf8"` → `color: THEME.accent`.

Also find the `sidebarIncome` label and the income-input area. The LABEL div has inline styles with hardcoded colors; update the label color from `#6b7280` to `THEME.textMuted`, keep structure. Same for the RESET DATA div (`color: #4b5058`) → `THEME.textFaint`.

**Step 4: Wrap content in contentInner**

Find:

```jsx
<div style={s.content}>
  {/* DASHBOARD */}
  {tab === "dashboard" && (
```

Replace with:

```jsx
<div style={s.content}>
  <div style={s.contentInner}>
    {/* DASHBOARD */}
    {tab === "dashboard" && (
```

And find the matching closing sequence at the end of the content div (just before `</main>`):

```jsx
          })()}
        </div>
      </main>
```

Change to:

```jsx
          })()}
        </div>
      </div>
    </main>
```

Count braces carefully. The existing structure is:
```
<div style={s.content}>
  ...blocks...
</div>
</main>
```
Becomes:
```
<div style={s.content}>
  <div style={s.contentInner}>
    ...blocks...
  </div>
</div>
</main>
```

**Step 5: Verify visual — light theme appears**

```js
preview_eval:
(async () => {
  await new Promise(r => setTimeout(r, 800));
  const body = getComputedStyle(document.body);
  const sidebar = document.querySelector('aside');
  const sidebarBg = sidebar ? getComputedStyle(sidebar).backgroundColor : null;
  return {
    sidebarBg,
    hasError: !![...document.querySelectorAll('*')].find(e => e.textContent === 'Loading...') && Date.now() > 0,
  };
})()
```

Then:
```js
preview_eval: preview_console_logs (level: "error")
```

Expected: sidebar background is `rgb(255, 255, 255)` or similar light, no console errors.

Take a screenshot to visually confirm:

```js
preview_screenshot
```

Expected: sidebar is white, main area is very light gray, cards are white with soft borders, no dark theme anywhere.

---

### Task 2: Remove hardcoded dark colors from tab blocks

**Files:**
- Modify: `src/App.jsx` — all tab render blocks (Dashboard, Expenses, Recurring, Upcoming, History)

**Step 1: Grep for remaining hardcoded colors**

Run:

```
Grep pattern: #[0-9a-f]{6}|#[0-9a-f]{3}
path: src/App.jsx
```

Expected: a long list. Identify the ones inside JSX inline styles (not inside the `THEME` or `CATEGORY_COLORS` constants, and not in the `s` object which we just rewrote). Categorize them:

- `#e4e5e7` / `#0c0d12` → old dark text colors → replace with `THEME.text`
- `#6b7280` → already neutral → replace with `THEME.textMuted`
- `#4b5058` / `#8a8f98` → old muted → replace with `THEME.textFaint`
- `#818cf8` / `#a78bfa` → old purple accents → replace with `THEME.accent`
- `#34d399` → old green → replace with `THEME.success`
- `#ef4444` → keep (matches new danger)
- `#fbbf24` → old amber → replace with `THEME.warning`
- `#f472b6` → old pink, used for "spent" amounts → replace with `THEME.danger` (for consistency — red means money going out)
- `#0c0d12` / `#111218` / `#14151c` / `#1e2028` / `#1a1c24` / `#2a2d38` → old dark surfaces → replace with appropriate light values (`THEME.surface`, `THEME.border`, etc.)

**Step 2: Do systematic find-and-replace**

Use `Edit` with `replace_all: true` for each color that appears multiple times. For colors that appear in ambiguous contexts, do them one by one.

Key replacements (run as Edits with `replace_all: true`):

```
"#818cf8" → THEME.accent (but this is a string in inline styles → use "THEME.accent" without quotes or keep as literal matching new accent "#0066ff")
```

Simpler approach: do literal color → literal color replacements since inline style values are strings, not JS references. Use `replace_all: true`:

- `"color: "#818cf8""` → `"color: "#0066ff""`  (all accent refs)
- `"background: "#818cf8""` → `"background: "#0066ff""`
- `"#a78bfa"` → `"#0066ff"` (used on Monthly: recurring total)
- `"#34d399"` → `"#10b981"` (all success/green)
- `"#fbbf24"` → `"#f59e0b"` (all warning/amber)
- `"#f472b6"` → `"#ef4444"` (all "spent" reds)
- `"#4b5058"` → `"#9ca3af"` (muted/faint)
- `"#6b7280"` → `"#6b7280"` (no change needed — this already works for muted on light)
- `"#14151c"` → `"#ffffff"` (old card bg → surface)
- `"#1e2028"` → `"#e5e7eb"` (old card border → light border)
- `"#0c0d12"` → `"#ffffff"` (old shell bg → surface, used in some nested spots)
- `"#1a1c24"` → `"#e5e7eb"`
- `"#2a2d38"` → `"#e5e7eb"`
- `"#8a8f98"` → `"#6b7280"`
- `"#e4e5e7"` → `"#0c0d12"` (text color inversion)
- `"rgba(129,140,248,0.1)"` → `"rgba(0,102,255,0.08)"`
- `"rgba(52,211,153,0.12)"` → `"rgba(16,185,129,0.12)"`
- `"rgba(251,191,36,0.12)"` → `"rgba(245,158,11,0.12)"`

Be careful — some of these may have already been replaced by the new `s` object in Task 1. Only replace occurrences that are still inline in JSX.

**Step 3: Verify visually**

```
preview_screenshot
```

Expected: all text readable, no black-on-black or white-on-white, colors look intentional.

---

### Task 3: Add category helpers

**Files:**
- Modify: `src/App.jsx` — add helpers near other helpers (after `ensureCurrentMonth`)

**Step 1: Add category helpers**

```js
function normalizeCatName(name) {
  return (name || "").trim();
}

// Find a category by name (case-insensitive). Returns the category object or null.
function findCategory(categories, name) {
  const n = normalizeCatName(name).toLowerCase();
  if (!n) return null;
  return categories.find((c) => c.name.toLowerCase() === n) || null;
}

// Ensure a category exists for the given name. Returns { categories, category }
// where categories is the (possibly-extended) list and category is the matched/created one.
function ensureCategory(categories, name) {
  const trimmed = normalizeCatName(name);
  if (!trimmed) return { categories, category: UNCATEGORIZED };
  const existing = findCategory(categories, trimmed);
  if (existing) return { categories, category: existing };
  // Create: pick next color/icon by index (excluding Uncategorized)
  const userCats = categories.filter((c) => c.name !== "Uncategorized");
  const idx = userCats.length;
  const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
  const icon = CATEGORY_ICONS[idx % CATEGORY_ICONS.length];
  const newCat = { name: trimmed, color, icon };
  return { categories: [...categories, newCat], category: newCat };
}

// Ensure data has a categories field and every entry has a category.
function migrateCategories(data) {
  const categories = Array.isArray(data.categories) ? [...data.categories] : [];
  // Ensure Uncategorized exists
  if (!categories.find((c) => c.name === "Uncategorized")) {
    categories.unshift({ ...UNCATEGORIZED });
  }
  // Backfill category on all entries
  const months = { ...data.months };
  for (const key of Object.keys(months)) {
    const m = months[key];
    const fix = (arr) => arr.map((e) => e.category ? e : { ...e, category: "Uncategorized" });
    months[key] = {
      ...m,
      expenses: fix(m.expenses || []),
      recurring: fix(m.recurring || []),
      upcoming: fix(m.upcoming || []),
    };
  }
  const template = (data.recurringTemplate || []).map((r) => r.category ? r : { ...r, category: "Uncategorized" });
  return { ...data, months, recurringTemplate: template, categories };
}
```

**Step 2: Update `defaultData` to include categories**

```js
function defaultData() {
  const cur = currentMonthKey();
  return {
    months: { [cur]: emptyMonth() },
    savingsGoalPercent: 20,
    recurringTemplate: [],
    categories: [{ ...UNCATEGORIZED }],
  };
}
```

**Step 3: Wire migration into load effect**

In the `App` useEffect, change:

```js
const migrated = ensureCurrentMonth(migrate(raw));
```

to:

```js
const migrated = migrateCategories(ensureCurrentMonth(migrate(raw)));
```

And also in the `else` branch that calls `ensureCurrentMonth(defaultData())`:

```js
setData(migrateCategories(ensureCurrentMonth(defaultData())));
```

**Step 4: Verify category migration via preview_eval**

```js
preview_eval:
(async () => {
  // Seed data without categories
  await window.storage.set("budget-app-data", JSON.stringify({
    months: {
      "2026-04": {
        income: 5000,
        expenses: [{ id: "e1", name: "Groceries", amount: 200, date: "2026-04-05" }],
        recurring: [{ id: "r1", name: "Rent", amount: 1500, frequency: "Monthly", dayOfMonth: 1 }],
        upcoming: [],
      },
    },
    recurringTemplate: [{ id: "t1", name: "Rent", amount: 1500, frequency: "Monthly", dayOfMonth: 1 }],
    savingsGoalPercent: 20,
  }));
  location.reload();
})()
```

Wait ~1s, then:

```js
preview_eval:
(async () => {
  await new Promise(r => setTimeout(r, 800));
  const stored = JSON.parse((await window.storage.get("budget-app-data")).value);
  return {
    hasCategories: Array.isArray(stored.categories),
    hasUncat: !!stored.categories?.find(c => c.name === "Uncategorized"),
    expCat: stored.months["2026-04"].expenses[0]?.category,
    recCat: stored.months["2026-04"].recurring[0]?.category,
    tplCat: stored.recurringTemplate[0]?.category,
  };
})()
```

Expected: `hasCategories: true`, `hasUncat: true`, `expCat: "Uncategorized"`, `recCat: "Uncategorized"`, `tplCat: "Uncategorized"`.

---

### Task 4: Category pill display component and column

**Files:**
- Modify: `src/App.jsx`

**Step 1: Add `CategoryPill` component**

After `TableHeader` component (~line 195):

```jsx
function CategoryPill({ categoryName, categories }) {
  const cat = findCategory(categories, categoryName) || UNCATEGORIZED;
  return (
    <span style={{ ...s.catPill, background: `${cat.color}15`, color: cat.color }}>
      <span style={{ ...s.catDot, background: `${cat.color}25` }}>{cat.icon}</span>
      {cat.name}
    </span>
  );
}
```

**Step 2: Add Category column to Expenses table**

Find the expenses tab block. Update the `TableHeader`:

```jsx
<TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "CATEGORY", flex: 1.2 }, { label: "DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 0.3, align: "center" }]} />
```

And add a `<div style={{ flex: 1.2 }}>...` cell in the rendered row right after the name cell:

```jsx
{cur.expenses.map((e) => (
  <div key={e.id} style={s.tableRow}>
    <div style={{ flex: 2, fontWeight: 600 }}>{e.name}</div>
    <div style={{ flex: 1.2 }}><CategoryPill categoryName={e.category} categories={data.categories} /></div>
    <div style={{ flex: 1, color: THEME.textMuted, fontSize: 13 }}>{e.date}</div>
    <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: THEME.danger }}>{fmt(e.amount)}</div>
    <div style={{ flex: 0.3, textAlign: "center" }}><button style={s.delBtn} onClick={() => patchCur({ expenses: cur.expenses.filter((x) => x.id !== e.id) })}>✕</button></div>
  </div>
))}
```

**Step 3: Same for Recurring and Upcoming tables**

- Recurring: add category column with flex 1.2, reduce frequency/day column flex if needed to fit.
- Upcoming: add category column with flex 1.2.

**Step 4: Add Category column to History detail tables**

In the History detail view, all three sub-tables (Expenses, Recurring, Upcoming) get the same Category column treatment.

**Step 5: Verify pills render**

```js
preview_eval:
(async () => {
  // Navigate to Expenses tab
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('↗\nExpenses')).click();
  await new Promise(r => setTimeout(r, 200));
  return { body: document.body.innerText.slice(0, 400), hasPill: document.body.innerText.includes('Uncategorized') };
})()
```

Expected: `hasPill: true`, Expenses tab shows the migrated Groceries expense with an "Uncategorized" pill.

---

### Task 5: CategoryPicker component (text input + suggestions dropdown)

**Files:**
- Modify: `src/App.jsx`

**Step 1: Add `CategoryPicker` component**

Near `FormModal`:

```jsx
function CategoryPicker({ value, onChange, categories }) {
  const [open, setOpen] = useState(false);
  const suggestions = categories.filter((c) => {
    if (c.name === "Uncategorized") return false;
    if (!value) return true;
    return c.name.toLowerCase().includes(value.toLowerCase());
  });
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        placeholder="e.g. Food, Transport"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={s.input}
      />
      {open && suggestions.length > 0 && (
        <div style={s.suggestBox}>
          {suggestions.map((c) => (
            <div key={c.name} style={s.suggestItem}
              onMouseDown={(e) => { e.preventDefault(); onChange(c.name); setOpen(false); }}>
              <span style={{ ...s.catDot, background: `${c.color}25` }}>{c.icon}</span>
              <span>{c.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Extend `FormModal` to handle `category` field type**

In `FormModal`, add a new branch in the field rendering:

```jsx
{f.type === "select" ? (
  <select ...>...</select>
) : f.type === "category" ? (
  <CategoryPicker value={vals[f.key] || ""} onChange={(v) => setVals({ ...vals, [f.key]: v })} categories={f.categories} />
) : f.type === "number" ? (
  ...existing...
) : (
  ...existing text...
)}
```

The `f.categories` comes from the field definition — caller passes `categories: data.categories` in the field spec.

**Step 3: Wire category field into each modal**

For the Expense modal:

```jsx
<FormModal title="Add Expense" fields={[
  { key: "name", label: "Name", placeholder: "e.g. Groceries" },
  { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0" },
  { key: "category", label: "Category", type: "category", categories: data.categories },
  { key: "date", label: "Date", type: "date", defaultValue: new Date().toISOString().slice(0, 10) },
]} onClose={() => setModal(null)} onSave={(v) => {
  const { categories, category } = ensureCategory(data.categories, v.category);
  const newExp = { id: uid(), name: v.name, amount: +v.amount, date: v.date, category: category.name };
  save({
    ...data,
    categories,
    months: { ...data.months, [curKey]: { ...cur, expenses: [...cur.expenses, newExp] } },
  });
  setModal(null);
}} />
```

Same pattern for Recurring and Upcoming modals — add `{ key: "category", label: "Category", type: "category", categories: data.categories }` to their field arrays, and update `onSave` to call `ensureCategory` and merge the result into `data.categories`.

For the Recurring modal, also persist category onto `recurringTemplate`:

```jsx
onSave={(v) => {
  const { categories, category } = ensureCategory(data.categories, v.category);
  const newItem = { id: uid(), name: v.name, amount: +v.amount, frequency: v.frequency || "Monthly", dayOfMonth: +v.dayOfMonth || 1, category: category.name };
  save({
    ...data,
    categories,
    months: { ...data.months, [curKey]: { ...cur, recurring: [...cur.recurring, newItem] } },
    recurringTemplate: [...data.recurringTemplate, { ...newItem }],
  });
  setModal(null);
}}
```

**Step 4: Update `FormModal` validator to not require category**

The existing validator is `vals.name && !isNaN(amountNum)`. Category is optional (defaults to Uncategorized). No change needed; just make sure onSave's `ensureCategory` handles empty strings (already does — returns `UNCATEGORIZED`).

**Step 5: Verify end-to-end**

```js
preview_eval:
(async () => {
  // Click Add Expense
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('↗\nExpenses')).click();
  await new Promise(r => setTimeout(r, 200));
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('Add Expense')).click();
  await new Promise(r => setTimeout(r, 200));
  const setVal = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')];
  setVal(inputs.find(i => i.placeholder === 'e.g. Groceries'), 'Lunch');
  setVal(inputs.filter(i => i.placeholder === '0')[1], '25');
  setVal(inputs.find(i => i.placeholder && i.placeholder.includes('Food')), 'Food');
  await new Promise(r => setTimeout(r, 100));
  [...document.querySelectorAll('button')].find(b => b.innerText === 'Save').click();
  await new Promise(r => setTimeout(r, 300));
  const stored = JSON.parse((await window.storage.get("budget-app-data")).value);
  return {
    categories: stored.categories.map(c => c.name),
    lastExpense: stored.months["2026-04"].expenses.slice(-1)[0],
  };
})()
```

Expected: `categories` includes `"Food"`, `lastExpense.category === "Food"`.

Then verify case-insensitive matching:

```js
preview_eval:
(async () => {
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('Add Expense')).click();
  await new Promise(r => setTimeout(r, 200));
  const setVal = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')];
  setVal(inputs.find(i => i.placeholder === 'e.g. Groceries'), 'Bus');
  setVal(inputs.filter(i => i.placeholder === '0')[1], '5');
  setVal(inputs.find(i => i.placeholder && i.placeholder.includes('Food')), 'food');  // lowercase
  await new Promise(r => setTimeout(r, 100));
  [...document.querySelectorAll('button')].find(b => b.innerText === 'Save').click();
  await new Promise(r => setTimeout(r, 300));
  const stored = JSON.parse((await window.storage.get("budget-app-data")).value);
  return {
    categories: stored.categories.map(c => c.name),
    categoriesCount: stored.categories.length,
    lastExpenseCat: stored.months["2026-04"].expenses.slice(-1)[0].category,
  };
})()
```

Expected: `categories` still contains exactly one "Food" (not "Food" AND "food"), `lastExpenseCat === "Food"` (preserved original case).

---

### Task 6: Update remaining formula

**Files:**
- Modify: `src/App.jsx` — App component's totals block and stat card subtitles

**Step 1: Update the totals block**

Find:

```js
const totalExpenses = cur.expenses.reduce((a, e) => a + e.amount, 0);
const totalRecurring = cur.recurring.reduce((a, e) => a + e.amount, 0);
const totalUpcoming = cur.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
const totalCommitted = totalExpenses + totalRecurring + totalUpcoming;
const savingsTarget = (cur.income * data.savingsGoalPercent) / 100;
const canInvest = Math.max(0, cur.income - totalCommitted - savingsTarget);
const remaining = cur.income - totalExpenses - totalRecurring;
const unpaidCount = cur.upcoming.filter((u) => !u.paid).length;
```

Replace with:

```js
const totalExpenses = cur.expenses.reduce((a, e) => a + e.amount, 0);
const totalRecurring = cur.recurring.reduce((a, e) => a + e.amount, 0);
const totalUnpaidUpcoming = cur.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
const totalAllUpcoming = cur.upcoming.reduce((a, e) => a + e.amount, 0);
const totalCommitted = totalExpenses + totalRecurring + totalAllUpcoming;
const savingsTarget = (cur.income * data.savingsGoalPercent) / 100;
const canInvest = Math.max(0, cur.income - totalCommitted - savingsTarget);
const remaining = cur.income - totalExpenses - totalRecurring - totalAllUpcoming;
const unpaidCount = cur.upcoming.filter((u) => !u.paid).length;
// Backwards-compat alias used by the breakdown bar
const totalUpcoming = totalUnpaidUpcoming;
```

**Step 2: Update the "Remaining" stat card subtitle**

Find:

```jsx
<StatCard label="Remaining" value={fmt(remaining)} accent={remaining >= 0 ? "#10b981" : "#ef4444"} sub="After expenses & recurring" icon="↓" />
```

Change `sub="After expenses & recurring"` → `sub="After everything this month"`.

**Step 3: Verify**

```js
preview_eval:
(async () => {
  // Reset and seed: income 5000, 1 expense 500, 1 unpaid upcoming 1000
  await window.storage.set("budget-app-data", JSON.stringify({
    months: {
      "2026-04": {
        income: 5000,
        expenses: [{ id: "e1", name: "Shopping", amount: 500, date: "2026-04-01", category: "Uncategorized" }],
        recurring: [],
        upcoming: [{ id: "u1", name: "Insurance", amount: 1000, dueDate: "2026-04-20", paid: false, category: "Uncategorized" }],
      },
    },
    recurringTemplate: [],
    savingsGoalPercent: 20,
    categories: [{ name: "Uncategorized", color: "#9ca3af", icon: "·" }],
  }));
  location.reload();
})()
```

Wait ~1s, then:

```js
preview_eval:
(async () => {
  await new Promise(r => setTimeout(r, 800));
  // Check remaining number on dashboard
  return { body: document.body.innerText.slice(0, 500) };
})()
```

Expected: the "REMAINING" value is `3500,00 zł` (= 5000 - 500 - 1000).

---

### Task 7: Final sanity check

**Step 1: Reset to a clean state and exercise everything**

```js
preview_eval:
(async () => {
  // Start fresh
  await window.storage.set("budget-app-data", JSON.stringify({
    monthlyIncome: 6000,
    savingsGoalPercent: 20,
    expenses: [{ id: "e1", name: "Coffee", amount: 15, date: "2026-04-08" }],
    recurring: [{ id: "r1", name: "Rent", amount: 1800, frequency: "Monthly", dayOfMonth: 1 }],
    upcoming: [{ id: "u1", name: "Gym", amount: 100, dueDate: "2026-04-15", paid: false }],
  }));
  location.reload();
})()
```

Wait, then:

```js
preview_eval:
(async () => {
  await new Promise(r => setTimeout(r, 800));
  const stored = JSON.parse((await window.storage.get("budget-app-data")).value);
  return {
    migrated: !!stored.months && !!stored.categories,
    defaultCat: stored.categories.find(c => c.name === "Uncategorized"),
    aprilExpenses: stored.months["2026-04"].expenses.map(e => ({ name: e.name, category: e.category })),
    aprilRecurring: stored.months["2026-04"].recurring.map(r => ({ name: r.name, category: r.category })),
    aprilUpcoming: stored.months["2026-04"].upcoming.map(u => ({ name: u.name, category: u.category })),
    remainingText: document.body.innerText.match(/-?\d+[,\.]?\d*\s*zł/g)?.slice(0, 5),
  };
})()
```

Expected:
- `migrated: true`
- `defaultCat` exists
- all entries have `category: "Uncategorized"`
- `remainingText` contains the right numbers (remaining should be 6000 - 15 - 1800 - 100 = 4085)

**Step 2: Take a final screenshot**

```
preview_screenshot
```

Visually confirm: light theme, wide layout, category pills visible, numbers correct.

---

## Checklist

- [ ] Task 1: theme tokens + rewritten `s` + layout wrapping
- [ ] Task 2: hardcoded dark colors scrubbed from JSX
- [ ] Task 3: category helpers + migration hooked into load
- [ ] Task 4: CategoryPill component + columns added to all tables
- [ ] Task 5: CategoryPicker component + wired into all three modals
- [ ] Task 6: remaining formula includes all upcoming
- [ ] Task 7: end-to-end sanity check passes
