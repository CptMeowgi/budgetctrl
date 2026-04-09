# Budget fixes — Savings cap, Credits, Variable Spend chart — Design

**Date:** 2026-04-09
**Scope:** Three discrete fixes to `src/App.jsx` that correct misleading dashboard math, add a missing concept (positive income events), and make the trajectory chart meaningful.

## Problems

1. **Savings-goal slider eats Upcoming visually.** The Income Breakdown bar renders a `savingsTarget = income * pct%` segment that is uncapped, so at high slider values the blue Savings segment grows past what's actually available and obscures the orange Upcoming segment. The underlying math already clamps `canInvest` to `max(0, …)`, but the bar does not reflect that clamp.

2. **No way to record refunds, gifts, or one-off positive income.** Users can only change `cur.income` (a standing monthly figure), which misrepresents a one-time inflow as a permanent salary change.

3. **Daily Spend trajectory is meaningless.** Fixed charges (recurring, upcoming) and variable one-offs are summed into the same "actual" cumulative line, which is compared against a linear pace line. Rent hitting day 1 instantly pushes the actual line far above pace; later in the month the line flattens and drifts below pace. The comparison answers no useful question.

## Decisions

| # | Decision | Chosen option |
|---|---|---|
| 1 | Savings behavior when goal > available | Cap savings display at `max(0, effectiveIncome − committed)`; show shortfall note |
| 2 | Refunds model | New top-level **Credits** tab with its own list and add-form |
| 3 | Credits in totals | Credits increase `effectiveIncome`; savings target stays based on base income only |
| 4 | Daily Spend chart fate | Replace with **Variable Spend** chart that excludes fixed charges from both actual and pace |

## Design

### 1. Savings-goal cap

**Math (replaces lines ~496–505 in `App.jsx`):**
```js
const totalCredits = (cur.credits || []).reduce((a, c) => a + c.amount, 0);
const baseIncome = cur.income;
const effectiveIncome = baseIncome + totalCredits;
const committed = totalExpenses + totalRecurring + totalAllUpcoming;
const savingsTargetRaw = (baseIncome * data.savingsGoalPercent) / 100;
const availableAfterCommitted = Math.max(0, effectiveIncome - committed);
const savingsTarget = Math.min(savingsTargetRaw, availableAfterCommitted);
const savingsShortfall = savingsTargetRaw - savingsTarget;
const canInvest = Math.max(0, availableAfterCommitted - savingsTarget);
const remaining = effectiveIncome - committed;
```

**UI:**
- Breakdown bar segments (`App.jsx:597–620` area) use the capped `savingsTarget` and the `effectiveIncome` denominator. Upcoming segment is always visible.
- Savings Goal card shows a small muted note `⚠ Short by {fmt(savingsShortfall)}` when `savingsShortfall > 0`.
- Slider still spans 0–50% freely — only display/math is capped.
- Savings target uses **base income only** so one-off refunds don't inflate the goal.

### 2. Credits (refunds / gifts / extra income)

**Data model — per-month:**
```js
credits: [{ id, name, amount, date, source }]
// source: free-text; suggestions = ["Refund", "Gift", "Bonus", "Other"]
```

**Migration:** `ensureCurrentMonth` initialises `credits: []` on any new month. A new `migrateCredits(data)` helper (called alongside `migrateCategories` in the hydration effect) walks existing months and adds `credits: []` where missing. `emptyMonth()` also gains `credits: []`.

**New tab:** `"Credits"` inserted between Upcoming and History in `TABS`. Icon: `+`.

**Credits tab view:** table-style list like Expenses. Columns: name, source, date, amount (green), delete. Empty state: "No credits this month. Use + Add Credit to log a refund, gift, or bonus."

**Add Credit modal:** uses existing `FormModal` with fields:
- `name` (text)
- `amount` (number, PLN, must be > 0)
- `source` (free-text with datalist suggestions Refund / Gift / Bonus / Other)
- `date` (date, default today)

Wired through the existing `modal.type === "credit"` branch in the JSX next to the expense/recurring/upcoming modal branches.

**Dashboard integration:**
- `effectiveIncome = baseIncome + totalCredits` flows through Remaining, Can Invest, breakdown bar (see §1).
- Monthly Income input in sidebar: unchanged; beneath it, `+{fmt(totalCredits)} credits` appears muted when `totalCredits > 0`.
- Credits do **not** participate in the Category donut.
- New compact "Recent Credits" mini-card shown on Dashboard only when `cur.credits.length > 0`, placed in the Recent Expenses / Upcoming Payments grid row (becomes a 3-column grid that month).
- `monthlyTotals` (chart helper) bumps `income` per data point to `income + credits` so the "over budget" red-bar logic stays consistent.

**History tab:** append a Credits column next to Income and Spent in any per-month summary rendered there.

**Out of scope (deferred):** recurring credits, split credits across months, credit categories mirrored into the donut. All rejected for YAGNI.

### 3. Variable Spend chart

**Rename:** card title "Daily Spend" → **"Variable Spend"**. Add subtitle text under `s.cardTitle`: `Excludes recurring & upcoming`.

**New helper — replaces `dailyCumulative`:**
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

Key difference from the deleted `dailyCumulative`:
- **Fixed excluded** from both `actual` (only `expenses`, never `recurring`) and from the pace-line budget denominator.
- **Variable budget** = `effectiveIncome − fixed − cappedSavings`, a genuinely meaningful number.

**Component — `DailyLineChart` renamed to `VariableSpendChart`:**
- Pace line (dashed gray) drawn only when `variableBudget > 0`.
- When `variableBudget <= 0`, the chart still renders the actual line so users can see where their one-offs land, plus an overlay message: `Fixed costs (≥ {fmt(fixed)}) consume your budget. No variable spend headroom.`
- Tooltip: `Day N` header, then `Spent {fmt(actual)}` in accent color, `Pace {fmt(pace)}` muted, and a third line showing `{Over|Under} {fmt(|actual−pace|)}` colored red/green.
- Empty state (no one-off expenses this month): `No variable spending yet this month.` (unchanged wording).

**Rationale:**
- Rent no longer slams actual up on day 1.
- Pace represents discretionary runway per day — the number users actually want to stay under.
- Uses existing per-expense dates (`e.date`, default today from form); no new data capture required.

## Non-goals

- Recurring credits (deferred — one-off only for v1).
- Per-category budgets / caps (Phase 2).
- Migrating historical data to split fixed/variable retroactively — the chart works forward from current month's data as-is.
- Forecasting beyond current month (Phase 2).
- Mobile responsive breakpoints — desktop only.

## Files touched

- `src/App.jsx` — all three fixes land in this single file (matches existing architecture).
- `docs/plans/2026-04-09-budget-fixes.md` — implementation plan (created after this design).

## Verification strategy

Single-file React app with no tests. Each task verified via Claude Preview MCP:
- `preview_eval` to seed test data and assert DOM/localStorage state.
- `preview_screenshot` for visual regressions.
- `preview_console_logs level=error` after every edit to catch compile errors.
