# Budget fixes — Savings cap, Credits, Variable Spend chart — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix the savings-goal slider so it can't visually consume Upcoming funds, add a Credits concept (refunds / gifts / extra income) with its own tab, and replace the misleading Daily Spend trajectory with a Variable Spend chart that excludes fixed charges.

**Architecture:** All changes land in `src/App.jsx` (single-file React app). Data model gains a per-month `credits` array. Dashboard math is reworked to compute `effectiveIncome = baseIncome + totalCredits` and a capped `savingsTarget`. A new top-level Credits tab and `FormModal` entry handle CRUD. The existing `dailyCumulative` helper and `DailyLineChart` component are replaced with `variableDaily` and `VariableSpendChart`.

**Tech Stack:** React 19, Vite, Recharts, localStorage. No tests — verification is via Claude Preview MCP (screenshots + `preview_eval` + `preview_console_logs`) as in Phase 1b.

**Reference design doc:** `docs/plans/2026-04-09-budget-fixes-design.md`

**Verification note:** Every task ends with a preview check. Server runs via `.claude/launch.json` (`budget-ctrl`, port 5173).

---

## Task 1: Extend data model with `credits`

**Files:**
- Modify: `src/App.jsx:79-81` (`emptyMonth`)
- Modify: `src/App.jsx:116-134` area (add `migrateCredits` helper)
- Modify: `src/App.jsx:458-475` (hydration effect — call new helper)

**Step 1: Update `emptyMonth`**

Replace the body of `emptyMonth` with:

```js
function emptyMonth() {
  return { income: 0, expenses: [], recurring: [], upcoming: [], credits: [] };
}
```

**Step 2: Add `migrateCredits` helper**

Immediately after `migrateCategories` (around line 134), insert:

```js
function migrateCredits(data) {
  const months = { ...data.months };
  for (const key of Object.keys(months)) {
    const m = months[key];
    if (!Array.isArray(m.credits)) {
      months[key] = { ...m, credits: [] };
    }
  }
  return { ...data, months };
}
```

**Step 3: Wire into hydration**

In the `useEffect` that hydrates (around line 464), change:

```js
const migrated = migrateCategories(ensureCurrentMonth(migrate(raw)));
```

to:

```js
const migrated = migrateCredits(migrateCategories(ensureCurrentMonth(migrate(raw))));
```

Also update the fallback on the `else` branch (around line 470):

```js
setData(migrateCredits(migrateCategories(ensureCurrentMonth(defaultData()))));
```

**Step 4: Update `ensureCurrentMonth`**

In `ensureCurrentMonth` (around line 167), the new-month literal currently reads:

```js
[cur]: {
  income: carriedIncome,
  expenses: [],
  recurring: (data.recurringTemplate || []).map((r) => ({ ...r, id: uid() })),
  upcoming: [],
},
```

Add a `credits: []` line so rolling into a new month starts with an empty credits array.

**Step 5: Verify in preview**

Start the server if needed:

```
mcp__Claude_Preview__preview_start name=budget-ctrl
```

Reload and check for errors:

```
mcp__Claude_Preview__preview_console_logs level=error
```

Seed a legacy-shaped record (no credits field) and confirm the migration populates it:

```js
mcp__Claude_Preview__preview_eval
  (() => {
    localStorage.setItem("budget-app-data", JSON.stringify({
      months: { "2026-04": { income: 5000, expenses: [], recurring: [], upcoming: [] } },
      recurringTemplate: [],
      savingsGoalPercent: 20,
      categories: [{ name: "Uncategorized", color: "#9ca3af", icon: "·" }],
    }));
    location.reload();
    return "seeded legacy";
  })()
```

After ~800ms:

```js
mcp__Claude_Preview__preview_eval
  (async () => {
    await new Promise(r => setTimeout(r, 800));
    const d = JSON.parse(localStorage.getItem("budget-app-data"));
    return { hasCredits: Array.isArray(d.months["2026-04"].credits), len: d.months["2026-04"].credits?.length };
  })()
```

Expected: `{ hasCredits: true, len: 0 }`. No console errors.

---

## Task 2: Add `Credits` tab to navigation

**Files:**
- Modify: `src/App.jsx:42-48` (`TABS` constant)

**Step 1: Insert the new tab**

Change `TABS` to:

```js
const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "◉" },
  { id: "expenses", label: "Expenses", icon: "↗" },
  { id: "recurring", label: "Recurring", icon: "↻" },
  { id: "upcoming", label: "Upcoming", icon: "◈" },
  { id: "credits", label: "Credits", icon: "+" },
  { id: "history", label: "History", icon: "◷" },
];
```

**Step 2: Update the topbar add-button label logic**

Find `src/App.jsx:560-564`:

```jsx
{tab !== "dashboard" && tab !== "history" && (
  <button style={s.addBtn} onClick={() => setModal({ type: tab === "expenses" ? "expense" : tab })}>
    + Add {tab === "expenses" ? "Expense" : tab === "recurring" ? "Recurring" : "Payment"}
  </button>
)}
```

Replace with:

```jsx
{tab !== "dashboard" && tab !== "history" && (
  <button style={s.addBtn} onClick={() => setModal({ type: tab === "expenses" ? "expense" : tab === "credits" ? "credit" : tab })}>
    + Add {tab === "expenses" ? "Expense" : tab === "recurring" ? "Recurring" : tab === "credits" ? "Credit" : "Payment"}
  </button>
)}
```

**Step 3: Verify**

```
mcp__Claude_Preview__preview_screenshot
```

Expected: sidebar now shows six items with "+ Credits" between Upcoming and History. Clicking Credits navigates to an empty content area (tab body not yet implemented — acceptable for this step). No console errors.

---

## Task 3: Credits tab list view

**Files:**
- Modify: `src/App.jsx` — add a new `{tab === "credits" && …}` block after the Upcoming block (around line 767, before the History block)

**Step 1: Compute `totalCredits` in the main App component**

Just after `const totalAllUpcoming = …` (around `App.jsx:499`), add:

```js
const totalCredits = (cur.credits || []).reduce((a, c) => a + c.amount, 0);
```

**Step 2: Add the Credits tab block**

Immediately after the closing `)}` of the Upcoming tab block and before the History block, insert:

```jsx
{/* CREDITS */}
{tab === "credits" && (
  <div style={s.card}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <div style={s.cardTitle}>Credits</div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981", fontSize: 16 }}>Total: {fmt(totalCredits)}</div>
    </div>
    {(cur.credits || []).length === 0 ? (
      <div style={s.empty}>No credits this month. Use "+ Add Credit" to log a refund, gift, or bonus.</div>
    ) : (
      <>
        <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "SOURCE", flex: 1.2 }, { label: "DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 0.3, align: "center" }]} />
        {[...cur.credits].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((c) => (
          <div key={c.id} style={s.tableRow}>
            <div style={{ flex: 2, fontWeight: 600 }}>{c.name}</div>
            <div style={{ flex: 1.2, color: "#6b7280", fontSize: 13 }}>{c.source || "Other"}</div>
            <div style={{ flex: 1, color: "#6b7280", fontSize: 13 }}>{c.date}</div>
            <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981" }}>+{fmt(c.amount)}</div>
            <div style={{ flex: 0.3, textAlign: "center" }}>
              <button style={s.delBtn} onClick={() => patchCur({ credits: cur.credits.filter((x) => x.id !== c.id) })}>✕</button>
            </div>
          </div>
        ))}
      </>
    )}
  </div>
)}
```

**Step 3: Verify**

Click the Credits tab in the preview, then:

```
mcp__Claude_Preview__preview_screenshot
```

Expected: "Credits" card with "Total: 0,00 zł" in green and an empty-state message. No console errors.

---

## Task 4: Add Credit modal

**Files:**
- Modify: `src/App.jsx` — add a new `{modal?.type === "credit" && …}` block next to the other modal branches (around line 930, after the `upcoming` modal)

**Step 1: Insert the credit modal branch**

After the `upcoming` FormModal block, insert:

```jsx
{modal?.type === "credit" && (
  <FormModal title="Add Credit" fields={[
    { key: "name", label: "Name", placeholder: "e.g. Amazon refund" },
    { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0" },
    { key: "source", label: "Source", placeholder: "Refund, Gift, Bonus, Other" },
    { key: "date", label: "Date", type: "date", defaultValue: new Date().toISOString().slice(0, 10) },
  ]} onClose={() => setModal(null)} onSave={(v) => {
    const amt = +v.amount;
    if (!v.name || !(amt > 0)) { setModal(null); return; }
    const newCredit = { id: uid(), name: v.name, amount: amt, date: v.date, source: (v.source || "Other").trim() || "Other" };
    patchCur({ credits: [...(cur.credits || []), newCredit] });
    setModal(null);
  }} />
)}
```

Note: no CategoryPicker — `source` is a plain text field. Validation rejects zero/negative amounts (silently closes modal; matches existing modals' lax style).

**Step 2: Verify add flow**

In preview: click Credits tab → "+ Add Credit" → fill name "Test refund", amount 150, source "Refund", leave date default → Save.

```
mcp__Claude_Preview__preview_screenshot
```

Expected: row appears in Credits list: `Test refund · Refund · today · +150,00 zł`. Total header shows `Total: 150,00 zł`. No console errors.

**Step 3: Verify delete**

Click the ✕ button on the row. Screenshot. Expected: back to empty state.

---

## Task 5: Capped savings + effective income math

**Files:**
- Modify: `src/App.jsx:496-505` (main totals block in App component)

**Step 1: Replace the totals block**

Replace lines 496–505 with:

```js
const totalExpenses = cur.expenses.reduce((a, e) => a + e.amount, 0);
const totalRecurring = cur.recurring.reduce((a, e) => a + e.amount, 0);
const totalUnpaidUpcoming = cur.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
const totalAllUpcoming = cur.upcoming.reduce((a, e) => a + e.amount, 0);
const totalCredits = (cur.credits || []).reduce((a, c) => a + c.amount, 0);
const baseIncome = cur.income;
const effectiveIncome = baseIncome + totalCredits;
const totalCommitted = totalExpenses + totalRecurring + totalAllUpcoming;
const savingsTargetRaw = (baseIncome * data.savingsGoalPercent) / 100;
const availableAfterCommitted = Math.max(0, effectiveIncome - totalCommitted);
const savingsTarget = Math.min(savingsTargetRaw, availableAfterCommitted);
const savingsShortfall = Math.max(0, savingsTargetRaw - savingsTarget);
const canInvest = Math.max(0, availableAfterCommitted - savingsTarget);
const remaining = effectiveIncome - totalCommitted;
const unpaidCount = cur.upcoming.filter((u) => !u.paid).length;
const totalUpcoming = totalUnpaidUpcoming;
```

(Note: `totalCredits` is now computed here — delete the duplicate that was added in Task 3 Step 1. If you did Task 3 first, move the computation here and remove the earlier one.)

**Step 2: Update the Savings Goal card to show shortfall**

Find the Savings Goal block in the Dashboard JSX (around `App.jsx:582-592`). Inside the right-side number display block, after the `{fmt(savingsTarget)}` line, add a conditional shortfall note:

```jsx
<div style={{ fontSize: 12, color: "#6b7280", fontWeight: 400 }}>{fmt(savingsTarget)}</div>
{savingsShortfall > 0 && (
  <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 500, marginTop: 4 }}>
    ⚠ Short by {fmt(savingsShortfall)}
  </div>
)}
```

**Step 3: Verify math with a capping scenario**

Seed data where committed > available headroom for the full goal:

```js
mcp__Claude_Preview__preview_eval
  (() => {
    localStorage.setItem("budget-app-data", JSON.stringify({
      months: { "2026-04": {
        income: 5000,
        expenses: [{ id: "e1", name: "Rent bump", amount: 2000, date: "2026-04-01", category: "Housing" }],
        recurring: [{ id: "r1", name: "Rent", amount: 2000, frequency: "Monthly", dayOfMonth: 1, category: "Housing" }],
        upcoming: [{ id: "u1", name: "Bill", amount: 800, dueDate: "2026-04-20", paid: false, category: "Housing" }],
        credits: [],
      }},
      recurringTemplate: [],
      savingsGoalPercent: 50,
      categories: [{ name: "Uncategorized", color: "#9ca3af", icon: "·" }, { name: "Housing", color: "#10b981", icon: "🏠" }],
    }));
    location.reload();
    return "seeded cap test";
  })()
```

Math sanity: income 5000, committed 4800 (2000+2000+800), target 50% = 2500, available = 200 → savingsTarget caps to 200, shortfall = 2300.

After 800ms reload wait, screenshot the dashboard:

```
mcp__Claude_Preview__preview_screenshot
```

Expected:
- Savings Goal card shows `50% · 200,00 zł · ⚠ Short by 2 300,00 zł`.
- Breakdown bar: Spent (red) + Upcoming (orange) fill ~96%, Savings (blue) fills the last ~4%, Investable (green) is absent (zero).
- Can Invest stat card shows `0,00 zł`.

---

## Task 6: Credits feed into breakdown bar and Remaining

**Files:**
- Modify: `src/App.jsx:597-620` area (breakdown bar segments)

**Step 1: Update breakdown bar denominators**

The existing bar uses `cur.income` in the denominators. Replace all four segment entries with `effectiveIncome`:

```jsx
<div style={s.breakdownBar}>
  {[
    { pct: ((totalExpenses + totalRecurring) / effectiveIncome) * 100, color: "#ef4444" },
    { pct: (totalUpcoming / effectiveIncome) * 100, color: "#f59e0b" },
    { pct: (savingsTarget / effectiveIncome) * 100, color: "#0066ff" },
    { pct: (canInvest / effectiveIncome) * 100, color: "#10b981" },
  ].filter((x) => x.pct > 0 && isFinite(x.pct)).map((seg, i) => (
    <div key={i} style={{ height: "100%", background: seg.color, width: `${Math.min(seg.pct, 100)}%`, transition: "width .3s" }} />
  ))}
</div>
```

Also update the `cur.income > 0 ?` guard a few lines up to `effectiveIncome > 0 ?`.

**Step 2: Sidebar credits subtitle**

Find the sidebar monthly-income input block (grep `Monthly Income`, around `App.jsx:530-538`). Add a conditional subtitle line directly below the input:

```jsx
{totalCredits > 0 && (
  <div style={{ fontSize: 11, color: "#10b981", marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
    + {fmt(totalCredits)} credits
  </div>
)}
```

**Step 3: Verify**

Seed rich data with credits:

```js
mcp__Claude_Preview__preview_eval
  (() => {
    localStorage.setItem("budget-app-data", JSON.stringify({
      months: { "2026-04": {
        income: 8000,
        expenses: [{ id: "e1", name: "Groceries", amount: 450, date: "2026-04-03", category: "Food" }],
        recurring: [{ id: "r1", name: "Rent", amount: 2000, frequency: "Monthly", dayOfMonth: 1, category: "Housing" }],
        upcoming: [{ id: "u1", name: "Car Insurance", amount: 600, dueDate: "2026-04-20", paid: false, category: "Transport" }],
        credits: [{ id: "c1", name: "Amazon refund", amount: 500, date: "2026-04-05", source: "Refund" }],
      }},
      recurringTemplate: [],
      savingsGoalPercent: 20,
      categories: [{ name: "Uncategorized", color: "#9ca3af", icon: "·" }, { name: "Food", color: "#ef4444", icon: "🍔" }, { name: "Housing", color: "#10b981", icon: "🏠" }, { name: "Transport", color: "#f59e0b", icon: "🚗" }],
    }));
    location.reload();
    return "seeded credits";
  })()
```

Math check: effectiveIncome 8500, committed 3050, savingsTarget = 20% * 8000 = 1600 (uncapped since 8500−3050=5450 > 1600), canInvest = 5450−1600 = 3850, remaining = 5450.

Screenshot:

```
mcp__Claude_Preview__preview_screenshot
```

Expected:
- "Remaining" stat card: `5 450,00 zł`.
- "Can Invest" stat card: `3 850,00 zł`.
- Sidebar: beneath Monthly Income 8000, a green `+ 500,00 zł credits` line.
- Breakdown bar segments sum visually to ~100% of the bar; no overflow.

---

## Task 7: Recent Credits mini-card on Dashboard

**Files:**
- Modify: `src/App.jsx:647-677` (the Recent Expenses / Upcoming Payments grid row in the Dashboard tab)

**Step 1: Make the grid dynamic**

The current row is a 2-column grid. When credits exist, it becomes 3-column. Replace the wrapper:

```jsx
<div style={{ display: "grid", gridTemplateColumns: totalCredits > 0 ? "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
  {/* existing Recent Expenses card */}
  {/* existing Upcoming Payments card */}
  {totalCredits > 0 && (
    <div style={s.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={s.cardTitle}>Recent Credits</div>
        <button style={s.linkBtn} onClick={() => setTab("credits")}>View all →</button>
      </div>
      {[...cur.credits].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 4).map((c) => (
        <div key={c.id} style={s.miniRow}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>{c.source} · {c.date}</div>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981", fontSize: 13 }}>+{fmt(c.amount)}</div>
        </div>
      ))}
    </div>
  )}
</div>
```

**Step 2: Verify**

Using the seeded data from Task 6 (which has a credit), screenshot the dashboard.

```
mcp__Claude_Preview__preview_screenshot
```

Expected: three cards in the bottom row — Recent Expenses, Upcoming Payments, Recent Credits. The Credits card shows `Amazon refund · Refund · 2026-04-05 · +500,00 zł`.

Clear the credit, reseed without credits, screenshot again. Expected: 2-column layout (Recent Credits card hidden).

---

## Task 8: Replace `dailyCumulative` with `variableDaily`

**Files:**
- Modify: `src/App.jsx:198-215` (`dailyCumulative`)

**Step 1: Replace the helper**

Replace `dailyCumulative` entirely with:

```js
function variableDaily(month, key, baseIncome, credits, savingsPct) {
  const [year, mon] = key.split("-").map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();

  const fixed = (month.recurring || []).reduce((a, r) => a + r.amount, 0)
              + (month.upcoming  || []).reduce((a, u) => a + u.amount, 0);
  const effective = baseIncome + credits;
  const savingsTargetRaw = (baseIncome * (savingsPct || 0)) / 100;
  const afterFixed = Math.max(0, effective - fixed);
  const savings = Math.min(savingsTargetRaw, afterFixed);
  const variableBudget = Math.max(0, afterFixed - savings);

  const out = [];
  let running = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    for (const e of (month.expenses || [])) {
      const d = Number((e.date || "").slice(8, 10));
      if (d === day) running += e.amount;
    }
    out.push({ day, actual: running, pace: (variableBudget / daysInMonth) * day });
  }
  return { data: out, variableBudget, fixed };
}
```

**Step 2: Update the caller**

Find the `const dailyData = dailyCumulative(...)` line (around `App.jsx:509`). Replace:

```js
const dailyResult = variableDaily(cur, curKey, baseIncome, totalCredits, data.savingsGoalPercent);
const dailyData = dailyResult.data;
const variableBudget = dailyResult.variableBudget;
const fixedTotal = dailyResult.fixed;
```

**Step 3: Verify compile**

```
mcp__Claude_Preview__preview_console_logs level=error
```

Expected: no errors. Dashboard still renders (existing `DailyLineChart` still consumes `dailyData` shape `{day, actual, pace}[]`, which is unchanged).

---

## Task 9: Rename chart to `VariableSpendChart` + handle zero-budget case

**Files:**
- Modify: `src/App.jsx` — rename `DailyLineChart` component and update its callsite
- Modify: `src/App.jsx:631` area (Dashboard card title)

**Step 1: Rename the component**

Find `function DailyLineChart({ data }) {` and change the signature to:

```jsx
function VariableSpendChart({ data, variableBudget, fixed }) {
```

Replace the existing empty-state early return with:

```jsx
if (!data.length) {
  return <div style={s.chartEmpty}>No variable spending yet this month.</div>;
}
const allZero = data.every((d) => d.actual === 0);
```

Remove the old `data.every((d) => d.actual === 0)` branch — it's now handled via `allZero` and an overlay (see below).

**Step 2: Conditional rendering inside the chart**

Replace the chart body so the pace line only renders when `variableBudget > 0`, and an overlay appears when `variableBudget === 0`:

```jsx
return (
  <div style={{ width: "100%", height: 240, position: "relative" }}>
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
          const delta = actual - pace;
          const deltaLabel = delta >= 0 ? "Over" : "Under";
          const deltaColor = delta >= 0 ? THEME.danger : THEME.success;
          return (
            <div style={s.chartTooltip}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Day {label}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.accent }}>Spent: {fmt(actual)}</div>
              {variableBudget > 0 && (
                <>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.textMuted }}>Pace: {fmt(pace)}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", color: deltaColor }}>{deltaLabel}: {fmt(Math.abs(delta))}</div>
                </>
              )}
            </div>
          );
        }} />
        {variableBudget > 0 && (
          <Line type="monotone" dataKey="pace" stroke={THEME.textFaint} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
        )}
        <Line type="monotone" dataKey="actual" stroke={THEME.accent} strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
    {variableBudget === 0 && (
      <div style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", fontSize: 12, color: THEME.warning, pointerEvents: "none" }}>
        Fixed costs ({fmt(fixed)}) consume your budget. No variable spend headroom.
      </div>
    )}
    {allZero && variableBudget > 0 && (
      <div style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", fontSize: 12, color: THEME.textMuted, pointerEvents: "none" }}>
        No one-off spending yet this month.
      </div>
    )}
  </div>
);
```

**Step 3: Update the Dashboard callsite**

Find the Dashboard card (around `App.jsx:631-634`):

```jsx
<div style={s.card}>
  <div style={s.cardTitle}>Daily Spend</div>
  <DailyLineChart data={dailyData} />
</div>
```

Replace with:

```jsx
<div style={s.card}>
  <div style={s.cardTitle}>Variable Spend</div>
  <div style={{ fontSize: 11, color: THEME.textMuted, marginTop: -4, marginBottom: 8 }}>Excludes recurring & upcoming</div>
  <VariableSpendChart data={dailyData} variableBudget={variableBudget} fixed={fixedTotal} />
</div>
```

**Step 4: Verify — rich-data case**

Seed the Task 6 data (with 500 credit, one-off 450 groceries, recurring rent 2000, upcoming 600) and screenshot.

Expected: chart titled "Variable Spend" with subtitle "Excludes recurring & upcoming". Actual line rises by 450 on day 3, otherwise flat. Pace line climbs steadily to reach ~5,450 at day 30 (effective 8,500 − fixed 2,600 − savings 1,600 = 4,300). Hovering day 3 tooltip shows Spent 450 / Pace ~430 / Over ~20 (red).

Math correction: effective 8500 − fixed 2600 (2000 recurring + 600 upcoming) − savings 1600 = variableBudget 4300.

**Step 5: Verify — zero-budget case**

Seed data where fixed exceeds effective income:

```js
mcp__Claude_Preview__preview_eval
  (() => {
    localStorage.setItem("budget-app-data", JSON.stringify({
      months: { "2026-04": {
        income: 3000,
        expenses: [],
        recurring: [{ id: "r1", name: "Rent", amount: 3500, frequency: "Monthly", dayOfMonth: 1, category: "Housing" }],
        upcoming: [],
        credits: [],
      }},
      recurringTemplate: [],
      savingsGoalPercent: 20,
      categories: [{ name: "Uncategorized", color: "#9ca3af", icon: "·" }, { name: "Housing", color: "#10b981", icon: "🏠" }],
    }));
    location.reload();
    return "seeded zero budget";
  })()
```

Screenshot expected: Variable Spend chart shows only a flat actual line at 0, no pace line, and the amber overlay "Fixed costs (3 500,00 zł) consume your budget. No variable spend headroom."

**Step 6: Console errors check**

```
mcp__Claude_Preview__preview_console_logs level=error
```

Expected: none.

---

## Task 10: Credits feed into `monthlyTotals` and History

**Files:**
- Modify: `src/App.jsx:217-224` (`monthlyTotals`)
- Modify: `src/App.jsx:776-813` (History list)
- Modify: `src/App.jsx:818-889` (History detail)

**Step 1: Update `monthlyTotals`**

Replace with:

```js
function monthlyTotals(data) {
  return Object.keys(data.months).sort().map((key) => {
    const m = data.months[key];
    const spent = (m.expenses || []).reduce((a, e) => a + e.amount, 0)
                + (m.recurring || []).reduce((a, e) => a + e.amount, 0);
    const credits = (m.credits || []).reduce((a, c) => a + c.amount, 0);
    return { key, label: monthLabel(key).slice(0, 3), spent, income: (m.income || 0) + credits };
  });
}
```

This keeps the over-budget red bar honest: a month is over only if `spent > (income + credits)`.

**Step 2: Update History list card**

In the per-month button (around `App.jsx:784-786`), change:

```js
const spent = m.expenses.reduce((a, e) => a + e.amount, 0) + m.recurring.reduce((a, e) => a + e.amount, 0);
const rem = m.income - spent;
```

to:

```js
const credits = (m.credits || []).reduce((a, c) => a + c.amount, 0);
const spent = m.expenses.reduce((a, e) => a + e.amount, 0) + m.recurring.reduce((a, e) => a + e.amount, 0);
const effective = m.income + credits;
const rem = effective - spent;
```

And change the Income cell display to show credits when present. Replace:

```jsx
<div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Income</div>
<div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{fmt(m.income)}</div>
```

with:

```jsx
<div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Income</div>
<div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{fmt(m.income)}</div>
{credits > 0 && (
  <div style={{ fontSize: 10, color: "#10b981", fontFamily: "'JetBrains Mono', monospace" }}>+{fmt(credits)}</div>
)}
```

**Step 3: Update History detail view**

In the detail block (around `App.jsx:818-836`), replace the opening math:

```js
const m = data.months[historyKey] || emptyMonth();
const spent = m.expenses.reduce((a, e) => a + e.amount, 0);
const rec = m.recurring.reduce((a, e) => a + e.amount, 0);
const upc = m.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
const committed = spent + rec + upc;
const sTarget = (m.income * data.savingsGoalPercent) / 100;
const canInv = Math.max(0, m.income - committed - sTarget);
const rem = m.income - spent - rec;
```

with:

```js
const m = data.months[historyKey] || emptyMonth();
const spent = m.expenses.reduce((a, e) => a + e.amount, 0);
const rec = m.recurring.reduce((a, e) => a + e.amount, 0);
const upc = m.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
const credits = (m.credits || []).reduce((a, c) => a + c.amount, 0);
const effective = m.income + credits;
const committed = spent + rec + upc;
const sTargetRaw = (m.income * data.savingsGoalPercent) / 100;
const availableH = Math.max(0, effective - committed);
const sTarget = Math.min(sTargetRaw, availableH);
const canInv = Math.max(0, availableH - sTarget);
const rem = effective - spent - rec;
```

Update the Income stat card `value={fmt(m.income)}` to `value={fmt(effective)}` and add a `sub` that mentions credits when `credits > 0`:

```jsx
<StatCard label="Income" value={fmt(effective)} accent="#10b981" sub={credits > 0 ? `+${fmt(credits)} credits` : "For this month"} icon="↑" />
```

Optional: add a "Credits" section at the bottom of the detail view (after Upcoming section) if `m.credits?.length`, rendering the same table as the main Credits tab. Skip for v1.

**Step 4: Verify**

Seed two months, one with credits, then navigate to History list and screenshot. Expected: the month with credits shows a small green `+X,XX zł` under its Income cell. Click into detail — the Income stat card reflects the credit-inclusive total. Monthly bar chart (Dashboard) treats credit months correctly (no red for months whose spent fits within effective).

```
mcp__Claude_Preview__preview_console_logs level=error
```

Expected: no errors.

---

## Task 11: End-to-end verification

**Files:** none (preview tests only)

**Step 1: Rich scenario**

Seed multi-month data with credits in the current month:

```js
mcp__Claude_Preview__preview_eval
  (() => {
    localStorage.setItem("budget-app-data", JSON.stringify({
      months: {
        "2026-03": {
          income: 7000,
          expenses: [{ id: "e1", name: "Groceries", amount: 900, date: "2026-03-06", category: "Food" }],
          recurring: [{ id: "r1", name: "Rent", amount: 2000, frequency: "Monthly", dayOfMonth: 1, category: "Housing" }],
          upcoming: [],
          credits: [],
        },
        "2026-04": {
          income: 8000,
          expenses: [
            { id: "e2", name: "Groceries", amount: 450, date: "2026-04-03", category: "Food" },
            { id: "e3", name: "Gym", amount: 120, date: "2026-04-05", category: "Health" }
          ],
          recurring: [{ id: "r2", name: "Rent", amount: 2000, frequency: "Monthly", dayOfMonth: 1, category: "Housing" }],
          upcoming: [{ id: "u1", name: "Car Insurance", amount: 600, dueDate: "2026-04-20", paid: false, category: "Transport" }],
          credits: [
            { id: "c1", name: "Amazon refund", amount: 300, date: "2026-04-04", source: "Refund" },
            { id: "c2", name: "Birthday gift", amount: 200, date: "2026-04-08", source: "Gift" }
          ],
        },
      },
      recurringTemplate: [],
      savingsGoalPercent: 20,
      categories: [
        { name: "Uncategorized", color: "#9ca3af", icon: "·" },
        { name: "Food", color: "#ef4444", icon: "🍔" },
        { name: "Housing", color: "#10b981", icon: "🏠" },
        { name: "Transport", color: "#f59e0b", icon: "🚗" },
        { name: "Health", color: "#8b5cf6", icon: "💊" }
      ],
    }));
    location.reload();
    return "seeded e2e";
  })()
```

Math walkthrough:
- baseIncome 8000, totalCredits 500, effectiveIncome 8500
- committed = 450 + 120 + 2000 + 600 = 3170
- availableAfterCommitted = 5330
- savingsTargetRaw = 1600, savingsTarget = 1600 (not capped)
- canInvest = 3730, remaining = 5330
- fixed (for variable chart) = 2000 + 600 = 2600
- variableBudget = 8500 − 2600 − 1600 = 4300

**Step 2: Dashboard screenshot**

```
mcp__Claude_Preview__preview_screenshot
```

Expected:
- Stat cards: Remaining `5 330,00 zł`, Still to Pay `600,00 zł`, Can Invest `3 730,00 zł`, Total Spent `2 570,00 zł`.
- Sidebar: Monthly Income `8000`, below it `+ 500,00 zł credits` in green.
- Breakdown bar: no overflow; Upcoming segment visible.
- Variable Spend chart: two lines, pace climbing to ~4,300 at day 30, actual stepping up on days 3 and 5.
- Donut center: `2 570,00 zł` (not counting upcoming or credits).
- Monthly bars: Mar + Apr, both blue (none over effective income).
- Bottom row: three cards — Recent Expenses, Upcoming Payments, Recent Credits (with Amazon refund + Birthday gift visible).

**Step 3: Credits CRUD**

Navigate to Credits tab. Add a new credit via the form. Delete one. Verify dashboard math updates reactively.

**Step 4: Savings cap check**

Via preview, slide savings goal to max (drag slider or set via eval):

```js
mcp__Claude_Preview__preview_eval
  (() => {
    const d = JSON.parse(localStorage.getItem("budget-app-data"));
    d.savingsGoalPercent = 50;
    localStorage.setItem("budget-app-data", JSON.stringify(d));
    location.reload();
    return "maxed";
  })()
```

Expected after 800ms: savingsGoalRaw = 4000, availableAfterCommitted = 5330, savingsTarget = 4000 (still not capped because 4000 ≤ 5330). No shortfall shown. Now make committed larger by adding a huge expense:

```js
mcp__Claude_Preview__preview_eval
  (() => {
    const d = JSON.parse(localStorage.getItem("budget-app-data"));
    d.months["2026-04"].expenses.push({ id: "huge", name: "Car repair", amount: 4000, date: "2026-04-02", category: "Transport" });
    localStorage.setItem("budget-app-data", JSON.stringify(d));
    location.reload();
    return "huge";
  })()
```

Expected: committed = 7170, availableAfterCommitted = 1330, savingsTarget caps to 1330, shortfall = 2670 → Savings Goal card shows `⚠ Short by 2 670,00 zł`. Breakdown bar: Upcoming segment still visible.

**Step 5: Tab stability**

Click through all six tabs. No console errors. Dashboard still renders correctly on return.

**Step 6: Console final check**

```
mcp__Claude_Preview__preview_console_logs level=error
```

Expected: no errors for the entire session.

---

## Out of scope

- Recurring credits (e.g., monthly allowance) → Phase 2
- Credit categories participating in the donut → rejected (muddles "spending" semantics)
- Forecast line predicting end-of-month variable spend → Phase 2
- Migrating historical data to split fixed/variable retroactively → not needed
- Mobile responsive breakpoints for charts → desktop only
