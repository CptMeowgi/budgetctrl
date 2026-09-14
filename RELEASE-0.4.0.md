# Budget Ctrl 0.4.0

The release that turns Budget Ctrl from a window you open into an app that
lives on your machine. It now sits in the system tray, reminds you about bills
before they land, and follows your actual payday rather than the calendar.

---

## Read this first — three things behave differently

**Closing the window no longer quits the app.** The ✕ hides Budget Ctrl to the
system tray, where it keeps watching for due bills. To actually exit, right-click
the tray icon and choose **Quit**. This is what makes reminders work when the
window is closed.

**Savings Goal is now an amount, not a percentage.** Your existing goal is
converted automatically — a 20% goal on 8 000 zł income becomes 1 600 zł per
period. Nothing to re-enter.

**The "Can Invest" card is gone.** It was the same calculation as the savings
goal viewed from the other side. What's left over after your goal is now shown
as **Left to spend** in the income breakdown.

---

## Bill reminders

Budget Ctrl can now tell you about bills before they're due, even when the
window is closed.

- **System tray** — the app keeps running in the tray with Open / Quit
- **Notifications** — one digest per day covering everything due, rather than a
  toast per bill. Overdue unpaid items are included, and stay included for 30
  days before being treated as abandoned
- **Lead time** — warns 3 days ahead by default, adjustable
- **Start with Windows** — optional, launches straight to the tray with no
  window

All of it is behind the new **⚙ Settings** panel in the top bar.

### Due Soon

A tab showing exactly what a reminder would fire for — the same list, so the
notification and the screen can never disagree. Each entry shows its date, how
many days remain, and which period it belongs to.

That last part matters: reminders look across every period for unpaid bills,
but the Upcoming tab only shows the current one. A payment left unpaid in an
earlier period was invisible in the app while still being counted in every
notification. Those now appear here, flagged with the period they came from.

Anything more than 30 days overdue had been dropping out of notifications
entirely and had nowhere else to surface — so it was simply forgotten. Due Soon
lists it regardless of age and marks it *not in reminders*.

### Bills that pay themselves

Upcoming payments and recurring items can be marked **Pays itself** — for direct
debits and card-on-file subscriptions. They settle on their own due date and
never send a reminder, so a bill that needs no action stops asking for one.

They are not silently marked paid: the distinction between "I paid this" and
"this pays itself" is kept, so your records stay honest.

---

## Budget periods that match your payday

If you're paid on the 10th, your budget month can now run the 10th to the 9th.

- Set **Month Starts On** in the sidebar (1–28)
- Period labels show the real range, e.g. *September · 10 Sep – 9 Oct*
- Recurring bills resolve to the date they actually land inside the period
- Changing the cutoff tells you how many entries would move and asks before
  moving them. Declining still applies the new cutoff and leaves history alone

---

## Savings

A dedicated **Savings** tab, and a goal you can actually act on.

- **Set aside each period** — a plain amount. The dashboard shows whether the
  period covers it, and says how much you're short if it doesn't, instead of
  quietly reducing your goal
- **Save up to** — a total target with a progress bar and a rough estimate of
  how many more periods you need at your recent pace
- **Saved so far** — cumulative across closed periods, on top of a starting
  balance you set once
- **Period by period** — every closed period's income, spend, change and running
  balance
- **Fix the past** — period income is editable directly in that table, and every
  row links through to its period for expenses. Periods you've corrected after
  the fact are marked *edited* with the date, so a hand-adjusted figure never
  looks like a calculated one

---

## Year view

- 12-month bars for the whole year, clickable through to any period
- Year-over-year comparison on income and spend
- Your five biggest one-off expenses
- Where income came from, broken down by source
- Navigation now moves between years that actually have data, instead of
  offering empty future years

---

## Credits

- Credits get proper **categories** (Refund, Gift, Bonus, Salary, Other) with
  their own colours, replacing free text
- **Recurring credits** for allowances, stipends and retainers, mirroring how
  recurring bills work
- Credits are date-aware: one counts toward your balance once its date passes,
  and shows as *pending* until then
- Income never leaks into the spending donut — the two stay separate

---

## Editing the past

- Every past period is fully editable: income, expenses, recurring items,
  upcoming payments and credits
- Editing a past period's recurring item deliberately does **not** rewrite the
  live template, and deleting one there removes only that period's instance — a
  historical correction shouldn't unschedule a future bill

---

## A new look

The interface has been rebuilt on Apple's published design language: a single
accent colour, a proper type scale with tighter headings, hairline borders
instead of drop shadows, pill buttons and search fields, and consistent 44px
touch targets. Light and dark both got a full pass, including scrollbars, which
used to stay white in dark mode.

The window itself is now custom-drawn — no Windows title bar. Minimise, maximise
and close are built into the top bar, and the whole bar is draggable.

---

## Fixes

- The donut total and the Total Spent card disagreed, because the donut counted
  recurring bills that weren't due yet
- A recurring bill set to day 31 never fired in short months; it now lands on
  the last day
- The Frequency dropdown offered Weekly and Yearly, but every calculation
  treated everything as monthly. Removed rather than left lying
- Two recurring items with the same name and amount could corrupt each other on
  edit or delete — they're now linked by a stable id
- Amounts of zero or less were accepted in most forms
- Sorting ignored case and accents
- Income carry-forward only looked at the immediately previous month, so a gap
  month reset it to zero
- The sidebar could not be fully seen at smaller window sizes — Export / Import /
  Reset were cut off
- Search fields overflowed their card by 25px on the right
- The "+ Add" button overlapped the window controls and could minimise the
  window instead of opening the form
- Disabled year buttons were nearly invisible in dark mode

---

## If you're coming from 0.2.0

0.3.0 was tagged but never published as an installer, so upgrading from 0.2.0
also brings:

- **Live Remaining** — a recurring bill only counts against Remaining once its
  day has passed, and an upcoming payment only once you mark it paid. Before
  this, money you hadn't spent yet was already deducted. The Remaining card
  shows what's still scheduled
- **Full light and dark themes** — light mode now flips the sidebar and top bar
  too, not just the main panel
- **Stacked sorting** — click a column to sort, Shift-click another to sort
  within it. Numbered markers show the order

---

## Upgrading

Your data migrates automatically on first launch. Nothing to export or re-enter.

If you want reminders to survive a reboot, open **⚙ Settings** and turn on
**Start with Windows**.

Notifications need the installed app — a shortcut created by the installer is
what lets Windows attribute the toast. Running from source won't reliably show
them.
