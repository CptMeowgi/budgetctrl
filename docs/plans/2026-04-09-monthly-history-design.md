# Monthly History — Design

## Goal

Let the user view past months' budget data. When a new calendar month begins, the previous month becomes visible and visitable as read-only history.

## Data model

Replace the flat `data` blob with a month-keyed structure:

```js
{
  months: {
    "2026-04": {
      income: 8000,
      expenses: [ {id, name, amount, date}, ... ],
      recurring: [ {id, name, amount, frequency, dayOfMonth}, ... ], // snapshot
      upcoming:  [ {id, name, amount, dueDate, paid}, ... ]
    },
    "2026-03": { ... }
  },
  savingsGoalPercent: 20,      // global setting
  recurringTemplate: [ ... ]   // master list used when creating a new month
}
```

- Expenses live in their own month based on `date`.
- Recurring is snapshotted into each month on creation; editing it in the current month does NOT retroactively change past months.
- Upcoming lives in the month of its `dueDate`.
- Income is per-month.
- `recurringTemplate` is the live master list used as the default when a new month is created.

## Month lifecycle

Automatic, calendar-based. On app load:

1. Compute `currentKey = YYYY-MM` from today's date.
2. If `months[currentKey]` doesn't exist: create it by:
   - Snapshotting `recurringTemplate` into `recurring`
   - Carrying over the previous month's `income`
   - Empty `expenses` and `upcoming`
3. All live tabs (Dashboard/Expenses/Recurring/Upcoming) operate on `months[currentKey]`.

No "close month" button. Months are created lazily on first load of a new calendar month.

## UI

### New sidebar entry: History (`◷`)

Placed after Upcoming.

### History list view (default)

- List of past months (most recent first), excluding the current month.
- Each row shows: month label (e.g. `April 2026`), total spent, income, remaining, a small color indicator (green if remaining ≥ 0, red otherwise).
- Click a row → drill into detail view.
- Empty state: "No past months yet. Come back after the month ends."

### Month detail view

- Dashboard-style stat cards at top (Remaining, Total Spent, Still to Pay, Can Invest).
- Three sections: Expenses, Recurring, Upcoming — same table layout as live tabs but read-only.
- `← Back to History` button at top.
- No add/edit/delete.

## Editing current month

Existing tabs unchanged in behavior, but read/write to `months[currentKey]`.

- Editing a recurring payment updates **both** `months[currentKey].recurring` and `recurringTemplate` (so next month picks up the change).
- Deleting a recurring payment: same — removes from both.
- Changing monthly income updates only `months[currentKey].income`.

## Migration

On first load after this change, migrate existing flat data:

- `expenses` → grouped by each expense's `date` into `months[YYYY-MM].expenses`. Expenses without a valid date go to the current month.
- `recurring` → becomes `recurringTemplate` AND snapshotted into the current month.
- `upcoming` → grouped by `dueDate` into the appropriate month.
- `monthlyIncome` → copied into current month's `income`.
- `savingsGoalPercent` → stays global.

## Edge cases

- Empty history: show empty-state message on History tab.
- Past month with no data: render empty stats (zeros) rather than erroring.
- Reset Data: still wipes everything (current behavior preserved).

## Testing

Manual verification via browser preview:

1. Load with existing flat data → migration runs, data preserved.
2. Add expense to current month → appears in current tabs, not in History.
3. Simulate new month (modify `currentKey` or system date) → new month auto-created with carried income and recurring snapshot.
4. History tab → click past month → read-only detail view → Back works.
5. Edit a recurring payment in current month → past months in History unchanged.
