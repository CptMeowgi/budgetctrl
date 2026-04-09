# Phase 1b — Dark shell wrapper + Dashboard charts — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Wrap the app in a dark outer frame with a rounded light inner panel, and add three Recharts-powered charts (category donut, daily cumulative line, monthly totals bar) to the Dashboard.

**Architecture:** Extend the existing `src/App.jsx` single-file React app. Sidebar and topbar flip to dark theme and sit directly on a new `#0c0d12` outer background; the main content area becomes a rounded light panel floating inside with 16px inset. Charts are new pure-function helpers + a few new components wired into the Dashboard tab. No data model changes.

**Tech Stack:** React 19, Vite, `recharts` (new), localStorage. No tests (single-file hobby app); verification via Claude Preview MCP as in Phase 1.

**Reference design doc:** `docs/plans/2026-04-09-phase1b-shell-charts-design.md`

**Verification note:** This repo has no test framework. Every task's verification step is a preview check (screenshot + `preview_eval` for DOM state) instead of unit tests. The preview server runs via `.claude/launch.json` on port 5173.

---

## Task 1: Install recharts

**Files:**
- Modify: `package.json` (via npm)

**Step 1: Install the dependency**

Run in a terminal (Bash):

```
npm install recharts
```

Expected: `package.json` gains `"recharts": "^2.x.x"` under dependencies, `node_modules` populated, no warnings beyond standard peer-dep noise.

**Step 2: Verify import resolves**

In `src/App.jsx`, near the top (right after `import { useState, useEffect, useCallback } from "react";`), add:

```jsx
import { PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from "recharts";
```

**Step 3: Verify in preview**

Reload preview and check console for errors:

```
mcp__Claude_Preview__preview_console_logs
  serverId: <current>
  level: error
```

Expected: no recharts-related errors. Tab content still renders as before.

---

## Task 2: Dark shell wrapper — outer background, panel inset

**Files:**
- Modify: `src/App.jsx` — `s` style object (near bottom of file)

**Step 1: Add new outer-theme tokens**

At the top of `src/App.jsx` near the existing `THEME` constant, extend it:

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
  // Phase 1b — outer dark frame
  outerBg: "#0c0d12",
  outerText: "#e5e7eb",
  outerTextMuted: "#9ca3af",
  outerBorder: "#1f2028",
  outerAccentSoft: "rgba(0,102,255,0.15)",
};
```

**Step 2: Update `s.shell` and `s.main` to dark**

In the `s` object:

- `shell.background` → `THEME.outerBg`
- `main.background` → `THEME.outerBg`
- `sidebar.background` → `THEME.outerBg`
- `sidebar.borderRight` → `"none"`
- `topbar.background` → `THEME.outerBg`
- `topbar.borderBottom` → `"none"`

**Step 3: Add `s.panel` — the rounded light inner panel**

Add a new style key:

```js
panel: {
  flex: 1,
  overflow: "auto",
  background: THEME.bg,
  borderRadius: 20,
  margin: "0 16px 16px 0",
  padding: 32,
},
```

And change `s.content` to use this new wrapper: rename `content` → keep, but update it to be the scroll container that already exists. Simpler: replace `s.content` body with the panel styling above (remove the old `{ flex: 1, overflow: "auto", padding: 36 }`).

**Step 4: Update sidebar item colors for dark background**

In `s.navItem`, change `color: THEME.textMuted` → `color: THEME.outerTextMuted`.

Add new `s.navItemActive`:

```js
navItemActive: { background: THEME.outerAccentSoft, color: "#ffffff" },
```

Update `s.sidebarIncome.borderTop` → `"1px solid " + THEME.outerBorder`.

Update `s.incomeInput`:
- `background: THEME.outerBorder`
- `border: "1px solid " + THEME.outerBorder`
- `color: THEME.success` (unchanged)

**Step 5: Update logo colors**

Find the sidebar logo block (grep for `BUDGET` in JSX). Ensure "BUDGET" text uses color `#ffffff` and "CTRL" stays `THEME.accent`. Update the style inline there if needed.

**Step 6: Update topbar title**

Find the `<h1>` or topbar title in JSX (the `Dashboard` / `Expenses` / ... page title). Change its color to `#ffffff`. Its subtitle (date) → `THEME.outerTextMuted`.

**Step 7: Update Reset Data link**

Grep for `RESET DATA`. Its style uses `color: "#9ca3af"` currently (or THEME.textFaint). Change to `color: THEME.outerTextMuted`.

**Step 8: Update Monthly Income label**

Label "Monthly Income" color → `THEME.outerTextMuted`.
"PLN" suffix color → `THEME.outerTextMuted`.

**Step 9: Verify visually**

```
mcp__Claude_Preview__preview_screenshot
```

Expected: dark frame surrounding a rounded light panel. Sidebar/topbar dark. Active nav item has translucent-blue background and white text. Everything inside the panel (cards, stat row, tables) unchanged from Phase 1.

Also:

```
mcp__Claude_Preview__preview_console_logs level=error
```

Expected: no errors.

---

## Task 3: Chart helper functions

**Files:**
- Modify: `src/App.jsx` — add helpers after `migrateCategories` and before `Modal`

**Step 1: Add `categoryBreakdown`**

```js
function categoryBreakdown(month, categories) {
  const totals = new Map();
  for (const item of [...(month.expenses || []), ...(month.recurring || [])]) {
    const name = item.category || "Uncategorized";
    totals.set(name, (totals.get(name) || 0) + item.amount);
  }
  return Array.from(totals.entries()).map(([name, value]) => {
    const cat = categories.find((c) => c.name === name) || { color: "#9ca3af", icon: "·" };
    return { name, value, color: cat.color, icon: cat.icon };
  }).sort((a, b) => b.value - a.value);
}
```

**Step 2: Add `dailyCumulative`**

```js
function dailyCumulative(month, key, income, savingsPct) {
  const [year, mon] = key.split("-").map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const targetSpendable = income * (1 - (savingsPct || 0) / 100);
  const out = [];
  let running = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    for (const e of (month.expenses || [])) {
      const d = Number((e.date || "").slice(8, 10));
      if (d === day) running += e.amount;
    }
    for (const r of (month.recurring || [])) {
      if (Number(r.dayOfMonth || 1) === day) running += r.amount;
    }
    out.push({ day, actual: running, pace: (targetSpendable / daysInMonth) * day });
  }
  return out;
}
```

**Step 3: Add `monthlyTotals`**

```js
function monthlyTotals(data) {
  return Object.keys(data.months).sort().map((key) => {
    const m = data.months[key];
    const spent = (m.expenses || []).reduce((a, e) => a + e.amount, 0)
                + (m.recurring || []).reduce((a, e) => a + e.amount, 0);
    return { key, label: monthLabel(key).slice(0, 3), spent, income: m.income || 0 };
  });
}
```

Note: `monthLabel` already exists in `App.jsx`. It returns e.g. `"April 2026"`, so `.slice(0, 3)` gives `"Apr"`.

**Step 4: Verify in preview**

Via `preview_eval`, mount a quick sanity check:

```js
(() => {
  // These are not exported — just verify no syntax error in compiled bundle
  return { ok: true };
})()
```

Expected: `{ ok: true }` (meaning the file compiles and hot-reloaded without errors).

---

## Task 4: CategoryDonut component

**Files:**
- Modify: `src/App.jsx` — add component after `CategoryPill`

**Step 1: Add `CategoryDonut` component**

```jsx
function CategoryDonut({ data, total }) {
  if (!data.length) {
    return <div style={s.chartEmpty}>Add expenses to see category breakdown.</div>;
  }
  return (
    <div style={{ position: "relative", width: "100%", height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={70} outerRadius={100} paddingAngle={2} stroke="none">
            {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
          </Pie>
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{d.icon} {d.name}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>{fmt(d.value)} · {pct}%</div>
              </div>
            );
          }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 11, color: THEME.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Total</div>
        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: THEME.text }}>{fmt(total)}</div>
      </div>
    </div>
  );
}
```

**Step 2: Add the new `s.chartEmpty` and `s.chartTooltip` style keys**

In the `s` object:

```js
chartEmpty: { textAlign: "center", color: THEME.textFaint, padding: "80px 20px", fontSize: 13 },
chartTooltip: { background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: THEME.text, boxShadow: THEME.shadowCard },
```

**Step 3: Verify the component file compiles**

Check console after reload:

```
mcp__Claude_Preview__preview_console_logs level=error
```

Expected: no errors.

---

## Task 5: DailyLineChart component

**Files:**
- Modify: `src/App.jsx` — add component after `CategoryDonut`

**Step 1: Add `DailyLineChart` component**

```jsx
function DailyLineChart({ data }) {
  if (!data.length || data.every((d) => d.actual === 0)) {
    return <div style={s.chartEmpty}>No spending yet this month.</div>;
  }
  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <CartesianGrid stroke={THEME.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" stroke={THEME.textFaint} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={THEME.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const actual = payload.find((p) => p.dataKey === "actual")?.value ?? 0;
            const pace = payload.find((p) => p.dataKey === "pace")?.value ?? 0;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Day {label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.accent }}>Spent: {fmt(actual)}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.textMuted }}>Pace: {fmt(pace)}</div>
              </div>
            );
          }} />
          <Line type="monotone" dataKey="pace" stroke={THEME.textFaint} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="actual" stroke={THEME.accent} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

**Step 2: Verify compile**

```
mcp__Claude_Preview__preview_console_logs level=error
```

Expected: no errors.

---

## Task 6: MonthlyBarChart component

**Files:**
- Modify: `src/App.jsx` — add component after `DailyLineChart`

**Step 1: Add `MonthlyBarChart` component**

```jsx
function MonthlyBarChart({ data }) {
  if (data.length < 2) {
    return <div style={s.chartEmpty}>Come back next month to see trends.</div>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <CartesianGrid stroke={THEME.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={THEME.textFaint} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={THEME.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.key}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.danger }}>Spent: {fmt(d.spent)}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.textMuted }}>Income: {fmt(d.income)}</div>
              </div>
            );
          }} />
          <Bar dataKey="spent" radius={[6, 6, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.spent > d.income ? THEME.danger : THEME.accent} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

**Step 2: Verify compile**

```
mcp__Claude_Preview__preview_console_logs level=error
```

Expected: no errors.

---

## Task 7: Wire charts into Dashboard layout

**Files:**
- Modify: `src/App.jsx` — the Dashboard tab block (grep for `tab === "dashboard"`)

**Step 1: Compute chart data before the return**

Inside the App component, right after the `const remaining = ...` totals block, add:

```js
const catBreakdown = categoryBreakdown(cur, data.categories || []);
const catTotal = catBreakdown.reduce((a, c) => a + c.value, 0);
const dailyData = dailyCumulative(cur, curKey, cur.income, data.savingsGoalPercent);
const monthlyData = monthlyTotals(data);
```

**Step 2: Restructure the Dashboard layout block**

Find the block under `{tab === "dashboard" && (` that currently contains the 4 stat cards, the `dashGrid` with Savings Goal + Income Breakdown + Recent Expenses + Upcoming Payments.

Replace the existing `<div style={s.dashGrid}>...</div>` with the new layout:

```jsx
{/* Savings goal + breakdown strip (compact, full width) */}
<div style={{ ...s.card, marginBottom: 16 }}>
  {/* Keep the existing "Savings Goal" slider + "Income Breakdown" bar code as-is,
      but put them in a 2-column grid within this one card */}
  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 24, alignItems: "center" }}>
    {/* LEFT: savings goal slider — existing markup */}
    {/* RIGHT: income breakdown bar + legend — existing markup */}
  </div>
</div>

{/* Charts row 1: daily line + category donut */}
<div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 16, marginBottom: 16 }}>
  <div style={s.card}>
    <div style={s.cardTitle}>Daily Spend</div>
    <DailyLineChart data={dailyData} />
  </div>
  <div style={s.card}>
    <div style={s.cardTitle}>By Category</div>
    <CategoryDonut data={catBreakdown} total={catTotal} />
  </div>
</div>

{/* Charts row 2: monthly bars */}
<div style={{ ...s.card, marginBottom: 16 }}>
  <div style={s.cardTitle}>Monthly Totals</div>
  <MonthlyBarChart data={monthlyData} />
</div>

{/* Recent expenses + upcoming payments (moved down) */}
<div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
  {/* existing Recent Expenses card */}
  {/* existing Upcoming Payments card */}
</div>
```

You'll need to carefully copy the existing Savings Goal slider JSX, Income Breakdown bar JSX, Recent Expenses JSX, and Upcoming Payments JSX into these new slots. Keep all inline styling from Phase 1 intact — only the wrapper structure changes.

**Step 3: Remove the old `s.dashGrid` usage**

`s.dashGrid` is no longer referenced after this restructure. Leave the key in `s` (harmless) or remove it.

**Step 4: Verify visually**

```
mcp__Claude_Preview__preview_screenshot
```

Expected: dashboard shows
1. Top row: 4 stat cards
2. Slim strip: savings goal + income breakdown
3. Charts row: daily line (wide) + category donut (narrow)
4. Monthly bars card
5. Recent expenses + upcoming payments cards

---

## Task 8: Seed data and end-to-end verification

**Files:** None (preview test only)

**Step 1: Seed rich test data**

Via `preview_eval`:

```js
(() => {
  localStorage.setItem("budget-app-data", JSON.stringify({
    months: {
      "2026-02": {
        income: 7000,
        expenses: [
          { id: "e1", name: "Groceries", amount: 800, date: "2026-02-04", category: "Food" },
          { id: "e2", name: "Fuel", amount: 300, date: "2026-02-10", category: "Transport" },
        ],
        recurring: [
          { id: "r1", name: "Rent", amount: 2000, frequency: "Monthly", dayOfMonth: 1, category: "Housing" },
        ],
        upcoming: [],
      },
      "2026-03": {
        income: 7000,
        expenses: [
          { id: "e3", name: "Groceries", amount: 900, date: "2026-03-06", category: "Food" },
          { id: "e4", name: "Dining out", amount: 350, date: "2026-03-15", category: "Food" },
          { id: "e5", name: "Uber", amount: 200, date: "2026-03-20", category: "Transport" },
        ],
        recurring: [
          { id: "r2", name: "Rent", amount: 2000, frequency: "Monthly", dayOfMonth: 1, category: "Housing" },
        ],
        upcoming: [],
      },
      "2026-04": {
        income: 8000,
        expenses: [
          { id: "e6", name: "Groceries", amount: 450, date: "2026-04-03", category: "Food" },
          { id: "e7", name: "Gym", amount: 120, date: "2026-04-05", category: "Health" },
          { id: "e8", name: "Books", amount: 80, date: "2026-04-07", category: "Entertainment" },
        ],
        recurring: [
          { id: "r3", name: "Rent", amount: 2000, frequency: "Monthly", dayOfMonth: 1, category: "Housing" },
          { id: "r4", name: "Netflix", amount: 50, frequency: "Monthly", dayOfMonth: 15, category: "Entertainment" },
        ],
        upcoming: [
          { id: "u1", name: "Car Insurance", amount: 600, dueDate: "2026-04-20", paid: false, category: "Transport" },
        ],
      },
    },
    recurringTemplate: [
      { id: "t1", name: "Rent", amount: 2000, frequency: "Monthly", dayOfMonth: 1, category: "Housing" },
      { id: "t2", name: "Netflix", amount: 50, frequency: "Monthly", dayOfMonth: 15, category: "Entertainment" },
    ],
    savingsGoalPercent: 20,
    categories: [
      { name: "Uncategorized", color: "#9ca3af", icon: "·" },
      { name: "Food", color: "#ef4444", icon: "🍔" },
      { name: "Transport", color: "#f59e0b", icon: "🚗" },
      { name: "Housing", color: "#10b981", icon: "🏠" },
      { name: "Entertainment", color: "#0066ff", icon: "🎮" },
      { name: "Health", color: "#8b5cf6", icon: "💊" },
    ],
  }));
  location.reload();
  return "seeded";
})()
```

**Step 2: Screenshot the dashboard**

```
mcp__Claude_Preview__preview_screenshot
```

Expected checks:
- Dark outer frame surrounds rounded light panel.
- **Category donut**: 5 segments (Housing, Food, Transport, Entertainment, Health) with color per category and center total showing `2700,00 zł` (2000 Housing + 450+80 Food + 0 Transport + 50+80 Ent + 120 Health — verify exact arithmetic).

  Actually, for April: Housing 2000, Food 450, Entertainment 50+80=130, Health 120, Transport 0 (car insurance is upcoming, not counted). Total spent on donut = 2000 + 450 + 80 + 50 + 120 = **2700**. Confirm tooltip shows correct per-segment breakdown on hover.
- **Daily line chart**: non-zero values on days 1, 3, 5, 7, 15. Dashed pace line diagonal. Hover tooltip shows Day N / Spent / Pace.
- **Monthly bar chart**: three bars (Feb, Mar, Apr). All blue (none exceed income). Hover shows full spent/income.

**Step 3: Test over-budget red bar**

```js
(() => {
  const d = JSON.parse(localStorage.getItem("budget-app-data"));
  d.months["2026-02"].income = 2000; // was 7000; now spent=3100 > income
  localStorage.setItem("budget-app-data", JSON.stringify(d));
  location.reload();
  return "adjusted";
})()
```

Screenshot again. Expected: Feb bar is red (`#ef4444`), Mar + Apr still blue.

**Step 4: Test empty states**

Reset data via Reset button, then screenshot dashboard. Expected:
- Donut: "Add expenses to see category breakdown."
- Line: "No spending yet this month."
- Monthly bar: "Come back next month to see trends." (only 1 month exists)

**Step 5: Test hot-reload stability**

Click through Dashboard → Expenses → Recurring → Upcoming → History → Dashboard. No console errors. Charts re-render correctly when returning to Dashboard.

---

## Out of scope

- Forecast line (predicted spending) → Phase 2
- Budget caps / per-category budgets → Phase 2
- Click-to-filter interactions on donut or bars → nice to have, later
- Responsive breakpoints for charts on narrow windows → not needed for desktop-focused app
