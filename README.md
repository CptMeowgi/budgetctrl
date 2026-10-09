# Budget Ctrl

A personal budgeting app for Windows. It lives in the system tray, follows your
actual payday rather than the calendar month, and tells you about bills before
they land.

Built with React and Tauri. Everything stays on your machine — there is no
account, no server, and nothing leaves the device.

---

## What it does

**Budget periods that match your payday.** If you're paid on the 10th, a budget
period runs the 10th to the 9th. Recurring bills resolve to the date they
actually land inside that period, including short months.

**Bills that chase you, not the other way round.** The app keeps running in the
tray after you close the window and sends a daily digest of anything due within
your lead window, plus anything still unpaid past its date. Bills that pay
themselves — direct debits, card-on-file subscriptions — can be marked as such
and will settle on their own date without ever reminding you.

**Your currency and number format.** Both are settings — pick the currency you
actually hold and how you want figures punctuated.

**Money in, not just money out.** Credits cover refunds, gifts, bonuses and
salary, as one-offs or recurring, and are kept separate from spending so they
never distort the category breakdown.

**A live Remaining figure.** A recurring bill only counts against Remaining once
its day has passed, and a one-off only once it's settled. What you see is money
you still have, not money you will eventually have spent.

**Savings with a target.** Set an amount to put aside each period and a total
you're saving up to. The app tracks cumulative savings across closed periods and
estimates how long the target will take at your recent pace.

**History you can correct.** Every past period is editable — income inline from
the Savings table, everything else in place. Periods corrected after the fact
are marked, so a hand-adjusted figure never passes for a calculated one.

### The tabs

| Tab | What it's for |
|---|---|
| **Dashboard** | Remaining, still to pay, total spent, savings goal, category breakdown |
| **Due Soon** | Exactly what a reminder would fire for, with dates and which period each came from |
| **Expenses** | One-off spending |
| **Recurring** | Bills that repeat each period |
| **Upcoming** | Scheduled one-off payments |
| **Credits** | Money in — refunds, gifts, bonuses, salary |
| **History** | Any past period, fully editable |
| **Reports** | Any year, the last 3/6/12 months or all time: each category month by month, what changed, top payees, biggest payments, CSV export |
| **Savings** | Cumulative total, goal progress, period-by-period table |

---

## Install

Download the `.msi` from [Releases](../../releases) and run it.

On first launch, open **⚙ Settings** to set your reminder lead time and, if you
want reminders to survive a reboot, turn on **Start with Windows**.

> Closing the window does **not** quit the app — it hides to the tray so
> reminders keep working. Quit from the tray icon's right-click menu.

---

## Running from source

Requires [Node.js](https://nodejs.org) 20.19+ or 22.12+ (Vite 8's floor) and the
[Rust toolchain](https://www.rust-lang.org/tools/install) with the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for Windows
(Microsoft C++ Build Tools and WebView2).

```bash
npm install
npm run tauri:dev
```

| Command | What it does |
|---|---|
| `npm run tauri:dev` | The full desktop app with hot reload |
| `npm run dev` | Browser only at `localhost:5173` — no tray, reminders or window chrome |
| `npm run tauri:build` | Produces an installer in `src-tauri/target/release/bundle/msi/` |
| `npm run build` | Builds the web assets only |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) for the logic in `src/lib/` |

Notifications need the installed app. Windows attributes a toast through a Start
Menu shortcut that only the installer creates, so they may not appear under
`tauri:dev`.

---

## How it's built

```
src/App.jsx          the entire UI, ~3k lines
src-tauri/src/lib.rs tray, close-to-tray, autostart, window lifecycle
```

React 19 + Vite on the front, Tauri v2 on the back. Charts are Recharts. There
is no component library and no CSS framework — styling is a token system
(`FONT`, `TYPE`, `RADIUS`, `SPACE`) transcribed from Apple's published design
language, rendered through inline styles.

**The due-date checker runs in JavaScript, not Rust.** Bills live in
`localStorage`, which Rust cannot read, and the period arithmetic — cutoff days,
resolving a day-of-month to a real date, deciding what counts as due — is
non-trivial. A Rust checker would have meant mirroring the data to a file and
reimplementing that arithmetic in a second language, where it would drift from
the copy the UI uses. Hiding a Tauri window doesn't kill its webview, so
close-to-tray *is* the background daemon, running the same code the screen does.

Rust's job is the shell: the tray icon and menu, converting a window close into
a hide, registering autostart, and handling the `--hidden` flag that lets a
login launch come up silently.

### Data

Everything is one JSON blob in the webview's `localStorage`, keyed by budget
period:

```
months: { "2026-09": { income, expenses[], recurring[], upcoming[], credits[] } }
savingsGoal, startingBalance, cutoffDay, reminders
recurringTemplate[], creditTemplate[], categories[], creditCategories[]
```

A period is keyed by the calendar month it *starts* in, so changing your cutoff
day doesn't invalidate existing keys. Schema changes go through a single
`hydrate()` pipeline that every entry point — load, import, reset — runs, so a
new migration is added in exactly one place.

Use **Export** in the sidebar for a backup; **Import** replaces everything after
a confirmation.

---

## Known limitations

- **Windows only.** Nothing is deliberately platform-locked, but the tray
  behaviour, window chrome and installer are only built and tested here.
- **One currency at a time** — set it in Settings, along with number
  formatting. Amounts are not converted between currencies.
- **Notifications need the installed build**, as above.
- Changing the cutoff day re-buckets entries by date and discards the markers
  on periods you'd previously corrected. It asks first, and the figures
  themselves are untouched.

---

## Licence

MIT — see [LICENSE](LICENSE). Use it, change it, ship it; attribution is the
only ask.

---

## Releases

See the [changelog](CHANGELOG.md) for what's in each version, and
[RELEASE-0.4.0.md](RELEASE-0.4.0.md) for the long-form 0.4.0 notes.
