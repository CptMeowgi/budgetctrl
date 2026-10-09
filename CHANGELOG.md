# Changelog

## Unreleased

### Your currency and number format
Currency and number formatting are settings now, and separate ones — someone in
Poland holding euros still wants `1 234,56`. Existing budgets keep exactly the
PLN formatting they had.

### Your data lives in a real file
The desktop app keeps your budget in a file on your machine instead of browser
storage, which the operating system can clear. Backups are taken daily and before
any import or restore; the newest 14 are kept and can be restored from Settings.

### Manage categories
Rename, merge, recolour or delete spending categories and income sources. Fixing a
typo is now a rename — renaming onto an existing category merges the two.

### Notes on entries
Any expense, bill, payment or credit can carry a note. Search finds entries by
their note and category as well as their name.

### Export to CSV
Every entry across every period as a spreadsheet, with spending negative so a SUM
gives your net. The file uses `;` and decimal commas where your number format
does, so it opens correctly in Excel set to Polish or German.

### Fixes
- A recurring bill marked **Pays itself** lost the flag when the next month began,
  and started sending reminders again
- Exported files were dated in UTC, so an export just after midnight carried
  yesterday's date

### Licence
Budget Ctrl is now MIT licensed.

---

## 0.4.2

Reminder fixes, and a bug that stopped recurring payments appearing in a new
month.

### Recurring payments now carry into the new month

If the app had been left running — which it now is, since closing the window
only hides it to the tray — nothing created the new budget period when the month
turned. Recurring payments and recurring credits didn't appear, and income
wasn't carried forward.

It also failed quietly: the app showed an empty month rather than an error, and
the first edit you made in it would have saved that empty month permanently,
losing the templates for that period.

The new period is now created whenever the date rolls over, not only when the
app starts. For a month that already came up empty, the **Recurring** and
**Credits** tabs now name what's missing and offer to add it back.

> **If you're upgrading mid-month**, check Recurring and Credits for the current
> month. If a banner appears, your bills are in the template and one click
> restores them.

### Due Soon

A tab showing exactly what a reminder would fire for — the same list, so the
notification and the screen can't disagree. Each entry shows its date, days
remaining, and which period it came from.

That last part matters. Reminders look across every period for unpaid bills,
but the Upcoming tab only shows the current one — so a payment left unpaid in
an earlier month was invisible while still being counted in every notification,
and looked like it was referring to a similarly-named bill you could see.

### Bills that pay themselves

Upcoming payments and recurring items can be marked **Pays itself**, for direct
debits and card-on-file subscriptions. They settle on their own due date and
never send a reminder.

They aren't silently marked paid — the difference between "I paid this" and
"this pays itself" is kept, so your records stay honest.

### Overdue bills no longer disappear

Anything more than 30 days overdue was dropping out of notifications *and* had
nowhere else to appear, so it was simply forgotten — real money owed, with
nothing anywhere pointing at it.

Notifications still stop chasing after 30 days, so a stale entry doesn't nag
forever, but Due Soon now lists it regardless of age and marks it
*not in reminders*.

### Notifications

- Each line carries its own amount and timing, instead of a bare list of names
- The title carries the total
- Clicking a toast opens the app on Due Soon

### Also

- A real README, replacing the Vite template

---

## 0.4.1

Bugfix release.

---

## 0.4.0

The release that turned Budget Ctrl from a window you open into an app that
lives on your machine: system tray, bill reminders, payday-aligned budget
periods, the Savings tab, custom window chrome and a full visual rebuild.

See [RELEASE-0.4.0.md](RELEASE-0.4.0.md) for the detail.

---

## 0.3.0

- **Live Remaining** — a recurring bill only counts against Remaining once its
  day has passed, and a one-off only once marked paid
- **Full light and dark themes** — light mode flips the sidebar and top bar too
- **Stacked sorting** — click a column to sort, Shift-click another to sort
  within it

---

## 0.2.0

First packaged Windows installer.

---

## 0.1.0

Initial release.
