# Changelog

## Unreleased

- Save up for yearly or quarterly bills a little each period. Tick Save up for it on the bill.
- Savings goals don't count money saved up for bills.
- Try a sample budget from the welcome screen. Nothing in it is saved.
- The welcome screens come back if you close the app before finishing them.
- Lock past periods so they can't be changed by accident (Settings).
- Put categories in groups, with totals on the Dashboard and in Reports.
- Leave a category out of Reports, for one-off big purchases.
- Select several expenses or credits to recategorise or delete them at once.
- A check-up in Settings → Data finds duplicates, unpaid past bills and other likely mistakes.

## 0.7.0

- Budget periods can follow weekly or fortnightly pay (Settings → You're paid).
- Recurring bills and credits can repeat every week or two.
- Statement import reads MT940, OFX, QFX and CAMT.053 files as well as CSV.
- Import remembers each bank's columns.
- Import rules can check the amount, rule out words, and be put in order.
- Better imports from banks like Alior: money in, card payments and payments abroad.
- Income and what you set aside now sit right under Remaining on the Dashboard.
- What's new shows once after each update.
- The Dashboard rearranges smoothly in a narrow window.

### Fixes
- Category amounts under Total Spent always fit.
- Dropdowns were unreadable in dark mode.
- Editing a recurring credit from History, search or the calendar opened the wrong form.
- Dates were a day off west of Greenwich.
- Changing your payday could start a period without its income or bills, or start one early.

## 0.6.0

- Settings → About lists the open-source software Budget Ctrl uses, with their licences.
- Report a problem or suggest an idea from Settings → About. Nothing from your budget is sent.
- A strict security policy: the app loads only its own code and connects only to itself.

## 0.5.2

- A damaged budget file no longer opens as an empty budget. You get the last good copy or your backups.
- Quick changes are always saved in the right order.
- The daily backup is taken before the day's first change.
- Backups are named with the time, so two on one day don't overwrite each other.
- The app has its proper icon.

### Fixes
- Amounts like 1 234,56 and 1.234,56 are read correctly everywhere.
- A recurring payment's day stays between 1 and 31.
- Import rules follow a category you rename, merge or delete.
- The / shortcut works in every language.
- A hand-edited budget file keeps its months.

## 0.5.1

- Budget Ctrl runs on Linux: an AppImage that updates itself, and a .deb for Ubuntu, Debian and Mint.
- On plain GNOME, the tray icon needs the AppIndicator extension.
- Nothing changes on Windows.

## 0.5.0

- Upgrading from 0.4.x: uninstall it first (your budget stays), then run this installer. Updates install themselves from now on.
- A new look, dark by default, with a light version.
- Currency and number format are separate settings.
- Your budget is kept in a file, with daily backups.
- Rename, merge, recolour or delete categories.
- Bills can repeat every 2, 3, 6 or 12 months.
- Add a note to any entry.
- Import bank statements from CSV, without counting anything twice.
- Export everything to CSV.
- Undo with Ctrl+Z, redo with Ctrl+Shift+Z, and more shortcuts listed in Settings.
- Reports: spending by category and month, what changed, top payees and more.
- Category budgets can roll over into next month.
- An Accounts tab, with net worth over time.
- Automatic updates, installed only when you click.
- Lock the app with a PIN.
- Welcome screens for a new budget.
- A calendar of bills, and a forecast of what's left to the end of the month.
- Split a payment across categories.
- Import rules remember how to file a payee.
- Payments that look like monthly bills are spotted for you.
- Search everything with Ctrl+F.
- Save toward several goals. Your old savings target becomes a goal showing the same amount.
- German, Spanish, Polish and Chinese.
- A tidier layout: the sidebar is just navigation, and Due Soon is part of Upcoming.
- Send a test reminder from Settings.
- MIT licence.

### Fixes
- New entries in a payday-based period got the wrong date.
- Pays itself was lost when a new month began.
- Exports were misdated just after midnight.
- A late payday could end a period a day early when the clocks changed.
- Tall dialogs ran off the screen.
- Clicking a reminder on Windows did nothing.
- Opening the app twice started a second copy.
- Paid upcoming payments were missing from category totals.
- Charts animated with Windows animations turned off.

## 0.4.2

- Recurring payments appear in a new month even if the app was left running. A banner restores any that went missing.
- A Due Soon tab shows exactly what reminders will fire for.
- Mark bills that pay themselves. They settle on their own and never remind you.
- Bills more than 30 days overdue stay on Due Soon.
- Notifications show each amount and the total.

## 0.4.1

- Bug fixes.

## 0.4.0

- System tray, bill reminders, periods that start on payday, the Savings tab and a new look. See [the 0.4.0 notes](docs/releases/0.4.0.md) for more.

## 0.3.0

- Remaining counts a recurring bill once its day has passed, and a one-off once it's paid.
- Full light and dark themes.
- Shift-click to sort by a second column.

## 0.2.0

- First Windows installer.

## 0.1.0

- First release.
