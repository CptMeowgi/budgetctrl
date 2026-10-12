# Changelog

## Unreleased

- Settings has a new About section listing the open-source software Budget
  Ctrl is built with, and each package's licence. Their licences ask for
  this, and until now the app didn't include it.
- Also under About: **Report a problem** and **Suggest an idea** open the
  matching form on GitHub with your app version filled in. Nothing from your
  budget is sent.
- The app now runs under a strict Content Security Policy: it can load only
  its own code, styles, fonts and images, and connect only to itself. If
  something hostile ever got into a budget file or an imported statement, it
  couldn't run code or send anything anywhere.

## 0.5.2

This release makes your budget harder to lose, fixes amounts typed with a
decimal comma, and gives the app its proper icon.

### Your budget, safer
- If your budget file is ever damaged, Budget Ctrl no longer opens an empty
  budget in its place, which your next change would have saved over. It opens
  the last good copy it keeps for you when there is one; otherwise it shows
  your backups and lets you pick one, open a backup file, or start again. The
  damaged file is always kept.
- Quick changes in a row are saved strictly in order. Before, two saves close
  together could finish the wrong way round and leave an older version on disk.
- The daily backup is taken before the day's first change, so it holds your
  budget as you left it the day before.
- Backups are named with their time as well as their date, so two taken the
  same day no longer overwrite each other. Settings lists them as "11 Oct
  2026, 14:32 · before a statement import" instead of file names.

### Fixes
- Amounts typed with a comma for decimals and a space or dot between
  thousands - "1 234,56" or "1.234,56" - are read correctly when adding a
  recurring payment, an upcoming bill, a credit or a category budget. They
  were read as 1 and 1.234.
- A recurring payment's day of the month is kept between 1 and 31.
- Import rules follow a category you rename, merge or delete, instead of
  filing new imports under its old name.
- The / shortcut jumps to the search box in every language, not only English.
- A budget file missing some parts, such as one edited by hand, keeps its
  months when opened rather than losing them.

### Icon
- The app's icon - on the desktop, the taskbar, the tray and in Linux app
  menus - is now the Budget Ctrl mark instead of a placeholder.

## 0.5.1

On Windows, nothing changes in this release. It brings Budget Ctrl to Linux.

### Linux
Budget Ctrl now runs on Linux as well as Windows. Each release has an
**AppImage**, which runs on most distributions and keeps itself up to date,
and a **.deb** for Ubuntu, Debian and Linux Mint, whose updates ask for your
password because they install for the whole system.

Bill reminders arrive as ordinary desktop notifications. The tray icon needs a
desktop that shows tray icons: Ubuntu, KDE Plasma, Cinnamon and most others
do; on plain GNOME, add the AppIndicator extension. Without one, open Budget
Ctrl from your app menu to bring back a window you closed.

## 0.5.0

> **Upgrading from 0.4.x?** Your budget comes with you - 0.5.0 finds it on
> first launch and keeps every month, entry, bill, category and setting.
> 0.4.x can't update itself, so this once: optionally click **EXPORT** in
> 0.4.x to save a backup file, uninstall 0.4.x from Windows Settings → Apps
> (your budget stays), then run this installer. From here on, updates install
> themselves.

### A new look
Budget Ctrl has been redesigned: a dark canvas with soft colour glows, glass
cards, the DM Sans typeface and line icons, with violet as the accent, green
for money in and orange for money out. Dark is the default; the sun/moon
button switches to a light version of the same design.

- **The Dashboard** leads with the money left this month: a line of how it
  has moved so far and, dashed, where it's heading by payday. Beside it,
  this month's spending as a running total, how it compares with the same
  day last month, and the three biggest categories. Below: recent
  transactions, category budgets - only the ones in use, the rest a click
  away - and this month's income plan. Bills due soon sit in a strip at the
  top.
- **The top bar** greets you on the Dashboard and has a search box, a bell
  that lights up when something is due, and the Add button.
- **Settings and the lock** are at the bottom of the sidebar.
- **Dates in lists** read "11 Oct" in your language instead of 2026-10-11.
- The font now ships with the app. It used to be fetched from Google Fonts
  each time the app started, the one thing that went online uninvited.

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
| Ctrl+1 … 9 | Switch tab |
| Ctrl+F | Search everything |
| Ctrl+L | Lock, when a PIN is set |
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

### App lock
**Settings → Privacy → Lock with a PIN** keeps Budget Ctrl closed to anyone else
using your computer. It locks when the app starts, after a spell of not using it
(you choose how long), when the window is minimised or hidden to the tray, and
whenever you press **Ctrl+L** or the lock button. Nothing of your budget shows
behind the lock screen, and repeated wrong tries make you wait.

The PIN itself is never stored, only a salted, deliberately slow hash of it, in
a small `lock.json` beside your budget. The lock doesn't encrypt your budget
file. Forgot the PIN? Delete `lock.json` and the lock is gone, with your
budget untouched.

### A welcome for new budgets
A fresh install opens with three short screens: your language, currency and number format,
when your month starts and this month's income, and some starter categories to
tick. Then start budgeting, or start straight from a bank statement. Moving
from another computer? Restore a backup from the first screen instead. Existing
budgets never see it.

### Calendar and the month ahead
The Upcoming tab now shows the month as a **calendar**: every bill, payment and
expected credit on its day, marked done, due or overdue; click one to edit it.

Above it, **Money left this month, looking ahead** follows what's left day by
day to the end of the month: down with each bill still to come, up with each
credit expected, and down by your usual everyday spending (your daily average
over the last three months). It tells you the lowest point and when, what's
left at the end, and warns if you'd run short and roughly when. The
Dashboard's Remaining card shows the lowest point too.

### Split a payment across categories
One receipt, several categories: in an expense, **Split across categories** turns
the category into parts, such as 150 zł Food and 50 zł Household for one
supermarket shop. Type the price of the items you're splitting off and the
first part shrinks to match; it won't save until the parts add up. Each part
counts toward its own category in budgets, reports and the category chart, search
finds the receipt under any of them, the spreadsheet export writes a row per
part, and renaming or merging a category updates the parts too.

### Import rules
Tell the statement import how to handle a payee once, and it remembers. While
reviewing an import, tick **Always** next to a row and every future
"BIEDRONKA …" goes under the category you chose, and the other rows from that
payee in the same import follow at once. In **Settings → Data → Import rules**
you can widen or narrow what a rule looks for and give it a clean name
("Biedronka" rather than "BIEDRONKA 1234 WARSZAWA"); the bank's own wording is
kept in the note, so search still finds it.

### Spotting regular payments
Payments that are really monthly bills, like Netflix, the gym or a phone plan,
are noticed once they've appeared on about the same day for about the same
amount in consecutive months. The Recurring tab lists them under **Looks like a
monthly bill**: **Make recurring** turns one into a recurring bill and this
month's payment into this month's bill, so nothing is counted twice, and
**Not a bill** stops the suggestion. A statement import tells you when it has
spotted any.

### Search everything
**Ctrl+F**, or the ⌕ button, searches every month at once: expenses, recurring
bills, payments and credits. Type part of a name, category or note (accents
don't matter, so "zabka" finds Żabka), or an amount, and narrow it down by type,
category, dates or amount. The total spent and received across the results is
shown as you type, and clicking one opens it to edit.

### Savings goals
Save toward several things at once. Each goal has a target and, if you like, a
month to reach it by, and counts one of two things:

- **the balance of an account** from the Accounts tab, such as a savings account
- **what your budget leaves over each month**, plus anything saved before

A goal shows how far along it is, what it needs a month to land on its date,
and when you'll get there at your current pace, warning you if that misses
the date. The Dashboard shows the total saved for goals, and when dated goals
need more than you're setting aside it says how much, with one click to set
that aside instead.

**Upgrading:** your savings target becomes a goal called "Savings" that counts
what your budget leaves over, starting from your old starting balance, so it
shows exactly what it did before. The separate Starting balance setting is
gone, and the Savings tab's history is now "Left over each month".

### Deutsch, Español, Polski, 中文
Budget Ctrl now speaks German, Spanish, Polish and Simplified Chinese as well
as English. Every screen, dialog, reminder and message is translated, with each
language's own plurals (1 cel, 2 cele, 5 celów) and dates (11. Oktober,
11 de octubre, 10月11日). It follows your Windows language, or choose one under
**Settings → Language** or on the first welcome screen. The categories Budget
Ctrl creates - the starter set and the default money-in sources - change
language with the app, and typing one's name in your language files under it
rather than making a copy. Categories you name yourself stay as you typed them.

### A tidier layout
- **The sidebar is just navigation now.** This month's income is set on the
  Dashboard; the day your month starts is in Settings, as a list rather than a
  number box; backups, restoring, spreadsheet export and starting again are in
  **Settings → Data**
- **Due Soon is part of Upcoming**: what's due or overdue sits at the top of the
  Upcoming tab, which carries the badge, and a clicked reminder opens there
- **The Dashboard is about this month**: a Due soon card replaces the monthly
  chart (now in Reports) and the recent-entry lists that repeated the tabs
- **Start again** backs up your budget first, and Ctrl+Z brings it back

### Fixes
- With a payday start, a new expense, payment or credit was dated the 1st of
  the calendar month - 1 September for the period that began on 25 August,
  which isn't in that period at all. A new entry now starts on today's date,
  or on the first day of the period it's going into
- A recurring bill marked **Pays itself** lost the flag when the next month began,
  and started sending reminders again
- Exported files were dated in UTC, so an export just after midnight carried
  yesterday's date
- With a payday of the 27th or 28th, a budget month could end a day early
  when the clocks went forward on one of its last days
- Dialogs taller than the window - Settings, in a smaller window - ran off the
  screen and couldn't be scrolled. They now fit the window and scroll inside
- Clicking a reminder did nothing on Windows; it just sat in the notification
  centre. It now opens Budget Ctrl on what's due - from the popup or later
  from the notification centre, and even if the app had been quit
- Opening Budget Ctrl while it was already running in the tray started a
  second copy, and two copies could save over each other's changes. It now
  brings the running copy forward
- **Send a test reminder** in Settings, to check notifications reach you
- Charts no longer animate when Windows' animation effects are turned off
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

See [the 0.4.0 notes](docs/releases/0.4.0.md) for the detail.

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
