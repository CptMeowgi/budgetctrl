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

### Yearly, quarterly and other repeating bills
Recurring bills and credits can now repeat every 2, 3, 6 or 12 months, not just
monthly — car insurance, annual subscriptions, a quarterly water bill, a yearly
bonus. Each appears only in the periods it actually falls in, so it counts toward
that month's totals and reminders and nowhere else. Bills that aren't due this
period are listed underneath with when they're next due.

### Notes on entries
Any expense, bill, payment or credit can carry a note. Search finds entries by
their note and category as well as their name.

### Import bank statements
Add transactions from your bank's CSV export instead of typing them in. Polish bank
files work as they come — Windows-1250 encoding, `;` separators, decimal commas and
the account summary above the table are all handled — and the columns are guessed
for you to confirm.

Nothing is counted twice. Before anything is added, each transaction is checked
against what your budget already holds: a purchase you entered by hand, a standing
order that's already a recurring bill, and your salary (already your income) are
left unticked, and a payment that settles an Upcoming bill marks it paid instead.
Every row shows why, and you can override any of them. Categories are suggested
from how you've filed similar entries before. Importing an overlapping statement
again adds nothing new. A backup is taken before every import.

### Export to CSV
Every entry across every period as a spreadsheet, with spending negative so a SUM
gives your net. The file uses `;` and decimal commas where your number format
does, so it opens correctly in Excel set to Polish or German.

### Undo, and keyboard shortcuts
Every change can be undone — deletes, edits, an import, even a reset — with
**Ctrl+Z** or the ↶ button, and redone with **Ctrl+Shift+Z** or **Ctrl+Y**. Typing a
figure counts as one step, not one per digit. Things you didn't do yourself, like a
new month starting, are never undone.

| Key | Does |
|---|---|
| Ctrl+1 … 0 | Switch tab |
| N | New entry on this tab |
| / | Search this tab |
| Esc | Close a dialog |

The full list is in Settings.

### Reports
The Year tab is now **Reports**, and opens on this year just as Year did. Pick any
year, the last 3, 6 or 12 months, or all time, and see:

- **Spending by category, month by month**, shaded so a category's busy months
  stand out, with totals and averages. Click a month to open it
- **What changed**: the categories that moved most against a fair comparison —
  the same months a year earlier, or the stretch just before
- **Top payees**, grouping one shop across store numbers and capitals —
  `BIEDRONKA 1234` and `Biedronka 77` are one place
- **Biggest one-off payments**, where it went, and income sources
- **Export CSV** of the category-by-month table

Averages and comparisons leave out the month still running; half a month always
looks thrifty.

### Category budgets that roll over
Any category with a budget can now **roll over what's left into next month** —
edit its budget and tick the box. Unspent budget carries forward; overspending
carries too, as a deficit, the way an envelope of cash would. The budget bar
shows what's available this month, with what carried in underneath. Counting
starts the month you switch it on, and **Start fresh** clears the balance.

Budgets now remember when they changed, so raising one this month doesn't
rewrite what earlier months carried.

### Accounts and net worth
A new **Accounts** tab. Add your current account, savings, cash, investments,
credit cards and loans, and type in each balance when you check it — **Update**,
the amount, Enter. Two updates on the same day correct each other rather than
piling up.

- **Net worth**, assets and debts, with the change over the last 30 days
- **Net worth over time**, each account carrying its last balance forward
- Each account's change since its previous balance, and its full history
- A note when a balance hasn't been updated for over a month
- **Close** an account to stop it counting without losing its history

For a card or loan, enter what you owe as a positive number.

### Automatic updates
Budget Ctrl now keeps itself up to date. Once a day it checks GitHub for a new
version and, when there is one, shows a banner with **What's new** and **Install
and restart**. Nothing installs until you click. A backup of your budget is taken
first, and an update not signed with the project's key is refused. You can turn
the daily check off, or check by hand, in **Settings → Updates**.

The installer is now a per-user setup `.exe` instead of an `.msi`. It needs no
admin rights, so updates install without a Windows permission prompt. **Coming
from 0.4.x:** uninstall it from Windows Settings → Apps first, then install this
version. Your budget is kept, and **Start with Windows** follows the app to its
new location by itself.

### Fixes
- A recurring bill marked **Pays itself** lost the flag when the next month began,
  and started sending reminders again
- Exported files were dated in UTC, so an export just after midnight carried
  yesterday's date
- Dialogs taller than the window - Settings, in a smaller window - ran off the
  screen and couldn't be scrolled. They now fit the window and scroll inside
- Clicking a reminder did nothing on Windows; it just sat in the notification
  centre. It now opens Budget Ctrl on what's due - from the popup or later
  from the notification centre, and even if the app had been quit
- Opening Budget Ctrl while it was already running in the tray started a
  second copy, and two copies could save over each other's changes. It now
  brings the running copy forward
- **Send a test reminder** in Settings, to check notifications reach you
- A paid Upcoming payment counted toward Total Spent but not toward its
  category, so a category could read untouched while actually over budget. The
  category chart, category budgets, History and the Year tab all left paid
  payments out; History also counted bills that weren't due yet. Every screen
  now uses one definition of what's been spent and received

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
