# Phase 1 — Redesign, Categories, Wider Layout — Design

Part of a 3-phase plan:
1. **Phase 1 (this doc):** Visual redesign (Revolut light theme), wider layout, categories, upcoming baked into remaining.
2. Phase 2 (future): Monthly budget cap + per-category sub-budgets, forecast, analytics.
3. Phase 3 (future): Desktop packaging (Tauri) — downloadable installer, local storage, native window.

## Goal

Transform the current dark/purple budget tracker into a Revolut-inspired light-themed desktop web app, add categories to every entry, include unpaid upcoming payments in the "remaining" calculation, and use the full browser width.

## Visual theme

Light theme modelled on the Revolut mobile screens in the user's reference image.

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#f4f5f7` | App background |
| `--surface` | `#ffffff` | Cards, modals, sidebar |
| `--border` | `#e5e7eb` | Card borders, dividers |
| `--text` | `#0c0d12` | Primary text |
| `--text-muted` | `#6b7280` | Labels, secondary text |
| `--text-faint` | `#9ca3af` | Placeholders, tertiary |
| `--accent` | `#0066ff` | Primary buttons, active nav, links |
| `--accent-soft` | `rgba(0,102,255,0.08)` | Active nav background |
| `--success` | `#10b981` | Positive amounts, paid |
| `--danger` | `#ef4444` | Negative amounts, overdue |
| `--warning` | `#f59e0b` | Upcoming, pending |

**Radii:** 16px for cards, 10px for inputs/buttons, 999px for pills.
**Shadows:** `0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)` for cards.
**Typography:** DM Sans for UI, JetBrains Mono for numbers (unchanged).

## Layout

- Sidebar stays fixed at 240px, restyled light.
- Main content fills the remaining viewport width.
- Inner content in `<main>` is wrapped in a container with `max-width: 1400px; margin: 0 auto` so it doesn't sprawl on ultra-wide monitors, but uses full width on typical displays. Padding stays at 36px.

## Categories

### Data model

Add `category: string` to every expense, recurring, and upcoming entry. Add a new top-level field:

```js
{
  months: { ... },
  recurringTemplate: [ ... ],
  savingsGoalPercent: 20,
  categories: [
    { name: "Food", color: "#f472b6", icon: "🍔" },
    { name: "Transport", color: "#818cf8", icon: "🚗" },
    // ...
  ]
}
```

- **Case-insensitive matching:** When a user types `food` and a category `Food` already exists, it reuses the existing one. Comparison uses `name.toLowerCase()`.
- **Auto-assigned metadata:** When a new category name is first used, the app picks the next color and a matching emoji icon from fixed palettes (cycled round-robin by index). These are persisted so colors stay stable.
- **Color palette (fixed):**
  `#ef4444` (red), `#f59e0b` (amber), `#10b981` (green), `#0066ff` (blue), `#8b5cf6` (purple), `#ec4899` (pink), `#14b8a6` (teal), `#f97316` (orange)
- **Icon palette:** a short list of emoji assigned round-robin when user doesn't pick one: `🍔 🚗 🛍️ 📄 🎮 💊 💰 🏠 ✈️ 🎁 ☕ 📱`
- **"Uncategorized"** is a permanent reserved category with neutral gray color (`#9ca3af`) and `·` icon. Used for migrated data and as a fallback.

### Category picker UI

In all three add/edit modals, the Category field is a text input with a **suggestions dropdown** that appears below:

- Shows all existing categories, filtered by the user's current typed text (case-insensitive substring match).
- Each suggestion shows: colored circle icon + name.
- Click a suggestion → fills the field.
- If the typed text doesn't match any existing category, it becomes a new category on save.
- Empty input shows all existing categories.

### Display

Expenses/recurring/upcoming tables get a new "Category" column: a small colored pill with emoji + category name. Dashboard "Recent Expenses" mini-list shows the colored dot next to each entry.

### Migration

On load, if an existing entry (in any month's `expenses`/`recurring`/`upcoming`) has no `category` field, set it to `"Uncategorized"`. Ensure `data.categories` exists and contains at least the Uncategorized entry.

## Remaining formula

Change:

```js
// before
const remaining = cur.income - totalExpenses - totalRecurring;
```

to:

```js
// after
const totalUnpaidUpcoming = cur.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
const remaining = cur.income - totalExpenses - totalRecurring - totalUnpaidUpcoming;
```

**Dashboard implications:**
- "Remaining" stat card sub-text changes from "After expenses & recurring" → "After everything committed this month".
- "Still to Pay" stat card stays but its sub-text changes from standalone to "(already subtracted from remaining)".
- "Can Invest" and income-breakdown bar formulas are already consistent with this — they subtract `totalUpcoming` separately. No change there.

## Error handling & edge cases

- **Category with empty name:** If user submits a blank category field, the entry is saved with `"Uncategorized"`.
- **Duplicate category names with different case:** Normalized to the case of the first-used version (what's already in `data.categories`).
- **Deleting a category:** Out of scope for Phase 1. Categories accumulate; manual cleanup comes in later phases if needed.
- **Migration safety:** Must be idempotent — running the migration on already-migrated data is a no-op.

## Testing

Manual verification via Claude Preview MCP (matches prior tasks):

1. **Visual:** Sidebar, topbar, and tabs render with light theme. Cards have white background, rounded corners, soft shadow. Accent blue on active nav, buttons.
2. **Width:** Main content expands past the old ~760px feel; resize window and confirm it scales up to ~1400px before capping.
3. **Category picker:** Add a new expense, type "Foo" → dropdown shows no matches, save → new "Foo" category appears with a color and icon. Add another expense, type "foo" (lowercase) → dropdown shows the existing "Foo", click → same category.
4. **Categories on all three types:** Add recurring with category, add upcoming with category — both show category pills in their tables.
5. **Migration:** Seed old-shape data (no categories), reload → all entries show "Uncategorized" pill; `data.categories` contains at least `Uncategorized`.
6. **Remaining formula:** Set income 5000, add expense 500, upcoming 1000 unpaid → Remaining = 3500. Mark upcoming paid → Remaining stays 3500 (because paid upcoming still shouldn't "add back" — wait, no: paid upcoming shouldn't subtract anymore since the money is already spent/gone. Verify below.)

### Clarification on paid upcoming

When `u.paid === true`, the upcoming item represents money already spent. It should NOT be subtracted from income a second time. But it ALSO isn't already in `expenses` (upcoming and expenses are separate lists). So:

- **Unpaid upcoming:** subtract from income (the money will leave soon).
- **Paid upcoming:** subtract from income (the money has already left). 

**Both states reduce remaining.** The only difference between paid and unpaid is the `unpaidCount` badge and the "Still to Pay" stat. Fixed formula:

```js
const totalUpcomingAll = cur.upcoming.reduce((a, e) => a + e.amount, 0);
const totalUnpaidUpcoming = cur.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
const remaining = cur.income - totalExpenses - totalRecurring - totalUpcomingAll;
```

The "Still to Pay" card shows `totalUnpaidUpcoming`. "Total Spent" card continues to show only `totalExpenses + totalRecurring` (doesn't include upcoming, since those aren't "spent" in the same sense).
