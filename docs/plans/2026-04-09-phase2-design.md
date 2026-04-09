# Phase 2 — Forecasting + Click-to-filter — Design

**Date:** 2026-04-09
**Scope:** Two additions to the existing dashboard. First, a linear variable-spend forecast that projects current velocity to month-end, surfaced both as a dashed line on the Variable Spend chart and as a new "Projected" stat card. Second, click interactions on the Dashboard's category donut and monthly bars that navigate the user into filtered or drilled-down views.

## Decisions

| # | Decision | Chosen option |
|---|---|---|
| 1 | Forecast method | Linear from day 1 (`actualToday / todayDay × daysInMonth`) |
| 2 | Forecast surface | Variable-only, on chart + new stat card |
| 3 | Forecast threshold | Hidden until day 5 of the current month |
| 4 | Donut click | Jump to Expenses tab filtered by that category |
| 5 | Monthly bar click | Jump to History detail for that month |

## Design

### 1. Forecasting

**Math inside `variableDaily` helper**

The helper already computes per-day `actual` and `pace`. Extend it:

```js
const today = new Date();
const curKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
const isCurrentMonth = key === curKey;
const todayDay = isCurrentMonth ? Math.min(today.getDate(), daysInMonth) : 0;
const actualToday = todayDay > 0 ? out[todayDay - 1].actual : 0;
const projectedVariable = todayDay >= 5
  ? (actualToday / todayDay) * daysInMonth
  : null;
```

Then augment the data array with a `projected` key **only when** `projectedVariable != null`:

```js
if (projectedVariable != null) {
  for (let i = 0; i < out.length; i++) {
    const day = i + 1;
    if (day < todayDay) out[i].projected = null;
    else if (day === todayDay) out[i].projected = actualToday;
    else {
      const t = (day - todayDay) / (daysInMonth - todayDay);
      out[i].projected = actualToday + (projectedVariable - actualToday) * t;
    }
  }
}
```

The helper's return type grows from `{ data, variableBudget, fixed }` to `{ data, variableBudget, fixed, todayDay, actualToday, projectedVariable }`.

**`VariableSpendChart` component**

Accepts new props `todayDay` and `projectedVariable`. When `projectedVariable != null`, renders an additional line:

```jsx
<Line
  type="monotone"
  dataKey="projected"
  stroke={THEME.warning}
  strokeWidth={2}
  strokeDasharray="6 3"
  dot={false}
  connectNulls={false}
/>
```

Tooltip gains a "Projected" row for days >= todayDay when the forecast is active, using `THEME.warning` color.

**Dashboard stat card**

A fifth stat card titled "Projected" joins `statsRow` when `projectedVariable != null`. The grid template flips from `repeat(4, 1fr)` to `repeat(5, 1fr)` when visible.

- Value: `fmt(projectedVariable)`
- Accent: `THEME.success` if `projectedVariable <= variableBudget`, else `THEME.danger`
- Sub: `"Under by " + fmt(variableBudget - projectedVariable)` or `"Over by " + fmt(projectedVariable - variableBudget)`
- Icon: `↗`
- When `variableBudget === 0`, sub becomes `"No variable budget"` and accent is neutral muted.

Before day 5, or on empty/future months: card is hidden. No placeholder — cleaner.

### 2. Click-to-filter

**New App-level state**

```js
const [expenseFilter, setExpenseFilter] = useState(null); // string category name or null
```

**Donut click (Dashboard → Expenses)**

`CategoryDonut` gains an `onSliceClick(name)` prop. Wired via Recharts' Pie onClick handler:

```jsx
<Pie data={data} dataKey="value" onClick={(entry) => onSliceClick?.(entry.name)} ...>
  {data.map((entry) => <Cell key={entry.name} fill={entry.color} cursor="pointer" />)}
</Pie>
```

Dashboard passes:
```jsx
<CategoryDonut data={catBreakdown} total={catTotal}
  onSliceClick={(name) => { setExpenseFilter(name); setTab("expenses"); }} />
```

**Expenses tab filter UI**

When `expenseFilter !== null`:
- A filter chip row appears above the table: `Filtered by: [Food ✕]`. Clicking the chip clears the filter.
- The expense list is filtered: `cur.expenses.filter(e => !expenseFilter || e.category === expenseFilter)`.
- The "Total" header value in the Expenses tab shows the filtered total, not the full monthly total.
- Empty state when filter matches nothing: `"No expenses in " + expenseFilter + ". Clear filter to see all."`
- Filter persists until manually cleared; switching tabs and returning preserves it.

**Monthly bar click (Dashboard → History detail)**

`MonthlyBarChart` gains two new props: `curKey` and `onBarClick(key)`. Bar element:

```jsx
<Bar dataKey="spent" onClick={(d) => d && d.key !== curKey && onBarClick?.(d.key)} radius={[6, 6, 0, 0]}>
  {data.map((d) => (
    <Cell
      key={d.key}
      fill={d.spent > d.income ? THEME.danger : THEME.accent}
      cursor={d.key !== curKey ? "pointer" : "default"}
    />
  ))}
</Bar>
```

Dashboard passes:
```jsx
<MonthlyBarChart data={monthlyData} curKey={curKey}
  onBarClick={(key) => { setTab("history"); setHistoryKey(key); }} />
```

The current month's bar is non-clickable since History excludes the current month anyway.

### 3. Files, non-goals, verification

**Files touched**
- `src/App.jsx` — all changes
- `docs/plans/2026-04-09-phase2-design.md` — this file
- `docs/plans/2026-04-09-phase2.md` — implementation plan (next)

**Non-goals** (deferred again to Phase 3+)
- Per-category budgets/caps
- Recurring credits
- Responsive / mobile layout
- Historical retroactive fixed/variable split
- Forecast for past months (Dashboard is current-month-only)
- Rolling-average or historical-average forecast methods
- Forecasting fixed charges (they're already known, no projection needed)

**Verification**
Claude Preview MCP: screenshots for visual regressions, `preview_eval` for DOM/localStorage assertions, `preview_console_logs level=error` after every edit. Test fixtures seed specific `today.getDate()` scenarios — but since `new Date()` is runtime, the forecast is naturally tested against whatever day the verification runs on. For deterministic testing we'll stub `Date` via `preview_eval` if needed.
