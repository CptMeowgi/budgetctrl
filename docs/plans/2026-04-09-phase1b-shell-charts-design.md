# Phase 1b — Dark shell wrapper + Dashboard charts — Design

Follows Phase 1 (Revolut-style redesign, categories, remaining formula). Pulls part of Phase 2 (charts) forward and restyles the app shell.

## Goal

Wrap the app in a dark outer "frame" with a rounded light panel for content (inspired by a reference mockup), and add three charts to the Dashboard: category donut, daily cumulative line, and monthly totals bar.

Terminology (Remaining / Still to Pay / Can Invest / Total Spent), categories, and the 240px labeled sidebar all stay as they are.

## Visual shell

Outer viewport gets a dark `#0c0d12` background. The **sidebar** and **topbar** become dark (part of the frame), and the **main content area** becomes a rounded light panel floating inside them with 16px inset on all sides.

| Token | Value | Usage |
|---|---|---|
| `--outer-bg` | `#0c0d12` | Shell background, sidebar, topbar |
| `--outer-text` | `#e5e7eb` | Sidebar labels, topbar title |
| `--outer-text-muted` | `#9ca3af` | Sidebar inactive icons, secondary text |
| `--outer-border` | `#1f2028` | Borders between sidebar/topbar/panel regions |
| `--outer-accent-soft` | `rgba(0,102,255,0.15)` | Active nav background |
| `--panel-bg` | `#f4f5f7` | Inner rounded panel (unchanged from Phase 1) |

Structure:

```
<div shell bg=outer-bg>
  <aside sidebar bg=outer-bg />         240px, dark
  <main bg=outer-bg flex-col>
    <header topbar bg=outer-bg />       dark, title white
    <div panel bg=panel-bg radius=20 margin=16 overflow=auto>
      <div contentInner max-width=1400>  {/* Phase 1 inner container */}
        ...existing cards/tables...
      </div>
    </div>
  </main>
</div>
```

Inside the rounded panel nothing changes — cards stay white, pills stay colored, tables stay as-is. Phase 1 work remains intact.

### Sidebar color flip

- Logo "BUDGET" → white, "CTRL" → accent blue (unchanged)
- Nav items: inactive `#9ca3af`, hover `#e5e7eb`, active background `rgba(0,102,255,0.15)` with text `#ffffff`
- Monthly Income block: border-top `#1f2028`, label `#9ca3af`, input background `#1f2028`, input text `#10b981` (unchanged green)
- Reset Data link: `#6b7280`

### Topbar

- Background `#0c0d12`, bottom border `#1f2028`
- Page title (`Dashboard` / `Expenses` / ...) now `#ffffff`, bolder (font-size stays 24px)
- Date subtitle `#9ca3af`

## Dashboard layout

Existing top row of 4 stat cards stays (unchanged). The block below it is reworked:

```
[ 4 stat cards                                                                    ]
[ Savings Goal + Income Breakdown (compact strip, full width)                     ]
[ Daily Spend line chart                 (2fr) ][ Category donut          (1fr) ]
[ Monthly Totals bar chart                                              (full)  ]
[ Recent Expenses                         (1fr) ][ Upcoming Payments       (1fr) ]
```

- Savings Goal slider + Income Breakdown bar: merged into a single slim horizontal strip card (full width, smaller height than today) so we don't lose them but they don't dominate.
- Chart row height: ~260px each for line/donut; monthly bar ~200px.
- Recent Expenses / Upcoming Payments lists: pushed below the charts, unchanged from Phase 1.

## Charts (Recharts)

Add `recharts` as a dependency: `npm i recharts`.

### Category donut

**Source:** `month.expenses` + `month.recurring` for current month, grouped by `category` (string). Upcoming excluded — those aren't "spent" yet.

```js
function categoryBreakdown(month, categories) {
  const totals = new Map();
  for (const item of [...month.expenses, ...month.recurring]) {
    const name = item.category || "Uncategorized";
    totals.set(name, (totals.get(name) || 0) + item.amount);
  }
  return Array.from(totals.entries()).map(([name, value]) => {
    const cat = categories.find((c) => c.name === name) || { color: "#9ca3af", icon: "·" };
    return { name, value, color: cat.color, icon: cat.icon };
  }).sort((a, b) => b.value - a.value);
}
```

Render with `<PieChart><Pie innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value" />`. Each segment `<Cell fill={entry.color}>`. Center label: total spent (expenses + recurring), using existing `fmt()`.

Tooltip: custom component showing the icon, name, amount, and percentage.

**Empty state:** "Add expenses to see category breakdown."

### Daily cumulative line chart

**Source:** days 1..lastDayOfMonth. For each day, sum:
- Expenses with `date` on or before that day (parse `YYYY-MM-DD`, extract day number)
- Recurring items with `dayOfMonth` on or before that day

```js
function dailyCumulative(month, monthKey, income, savingsPct) {
  const [year, mon] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const targetSpendable = income * (1 - savingsPct / 100);
  const out = [];
  let running = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    // expenses on this day
    for (const e of month.expenses) {
      const d = Number((e.date || "").slice(8, 10));
      if (d === day) running += e.amount;
    }
    // recurring on this day
    for (const r of month.recurring) {
      if (Number(r.dayOfMonth) === day) running += r.amount;
    }
    out.push({
      day,
      actual: running,
      pace: (targetSpendable / daysInMonth) * day,
    });
  }
  return out;
}
```

Render with `<LineChart>` containing two `<Line>` elements:
- `dataKey="actual"` stroke `#0066ff` strokeWidth 2.5, dot false
- `dataKey="pace"` stroke `#9ca3af` strokeWidth 1.5 strokeDasharray "4 4", dot false

X axis: `day` (1..lastDay). Y axis: currency with `fmt()` tick formatter. Tooltip shows both values for the day.

**Empty state:** "No spending yet this month."

### Monthly bars

**Source:** `data.months` sorted chronologically, all months included.

```js
function monthlyTotals(data) {
  return Object.keys(data.months).sort().map((key) => {
    const m = data.months[key];
    const spent = m.expenses.reduce((a, e) => a + e.amount, 0)
                + m.recurring.reduce((a, e) => a + e.amount, 0);
    return { key, label: monthLabel(key).split(" ")[0].slice(0, 3), spent, income: m.income };
  });
}
```

Render with `<BarChart>` containing `<Bar dataKey="spent">`. Each `<Cell>` colored `#0066ff` normally, `#ef4444` if `spent > income`. Y axis formatted with `fmt()`. Tooltip shows full month label, spent, income.

**Empty state:** if only 1 month exists, show "Come back next month to see trends."

## Data flow

No data model changes. All three derive from existing `data.months` and `data.categories`. Helper functions added after existing helpers (before the App component).

## Error handling & edge cases

- **No expenses, no recurring:** donut shows empty state, line chart shows empty state, monthly bar still renders current month (flat/empty bar).
- **Recurring with no `dayOfMonth`:** treat as day 1 for the line chart.
- **Expense with malformed `date`:** skip it in the line chart (still counted in totals).
- **Over-income month:** monthly bar turns red; donut still renders normally.
- **Tooltip amounts:** always use `fmt()` (PLN, comma decimals).

## Testing

Manual verification via Claude Preview MCP:

1. **Shell:** Reload with seeded data. Expect dark outer frame, rounded light panel inside, sidebar dark with blue active item, topbar dark with white title.
2. **Donut:** Dashboard shows category donut with colored segments for each category that has expenses or recurring. Hover shows tooltip with icon + name + amount + %.
3. **Line chart:** With seeded expenses across several days, line rises on those days. Dashed pacing line goes diagonally from day 1 to last day.
4. **Monthly bar:** Shows a bar per month from `data.months`. Seed a month where `spent > income` to verify bar turns red.
5. **Empty states:** Reset data. Expect all three charts to show empty state messages, not blank space or errors.
6. **Recharts bundle:** App still loads; no import errors in console.
