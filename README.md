# Budget Ctrl

A free, open-source budgeting app for Windows and Linux.

I built it because the other budgeting apps are paid or want a subscription,
and I wanted a free, open-source one for people to use. It's MIT licensed, so
you can also read the code, change it, or build on it.

Your budget is a file on your own computer. There's no account to create, it
doesn't ask for your bank login, and it doesn't send your data anywhere. The
only thing it connects to is GitHub, to check for updates.

![The Dashboard, with the money left this period, a forecast to payday, spending so far, recent transactions and category budgets](docs/screenshots/dashboard-dark.png)

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/dashboard-light.png" alt="The Dashboard in the light theme"><br><sub>Light theme</sub></td>
    <td width="50%"><img src="docs/screenshots/upcoming.png" alt="The Upcoming tab, with bills due soon"><br><sub>Bills coming up</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/reports.png" alt="Reports, with spending by month and by category"><br><sub>Reports</sub></td>
    <td width="50%"><img src="docs/screenshots/accounts.png" alt="Accounts, with net worth over time"><br><sub>Accounts and net worth</sub></td>
  </tr>
</table>

<sub>The screenshots use a made-up budget.</sub>

## What you can do with it

- **Budget from payday to payday.** Monthly from the day you're paid, or
  every week or two weeks if that's how your pay comes.
- **Add your bills once.** They come back every period, and the app reminds you
  before they're due, even with the window closed. Direct debits can be marked
  as paying themselves, so they don't remind you.
- **See what you actually have left.** A bill only counts once its date has
  passed. A forecast shows where the rest of the period is heading, and warns
  you if you'd run short before payday.
- **Give categories a budget.** Turn on rollover for things like gifts or car
  repairs, so what you don't spend carries over.
- **Import your bank statement** as CSV, MT940, OFX or CAMT.053. Anything
  already in your budget is recognised, so nothing is counted twice, and rules
  can name and file regular payments for you.
- **Track savings goals, account balances and net worth.**
- **Look back** with reports by month and category, find any entry with
  Ctrl+F, split a receipt across categories, and lock the app with a PIN.
- **Use it in your language and currency.** It's in English, German, Spanish,
  Polish and Simplified Chinese.

## Install

### Windows

Download `Budget.Ctrl_x.y.z_x64-setup.exe` from [Releases](../../releases) and
run it. It doesn't need admin rights.

The installer isn't code-signed yet, so Windows may say "Windows protected
your PC". Click **More info**, then **Run anyway**. If Edge asks whether to keep
the download, choose **Keep**. You only see this when installing; updates from
inside the app don't ask.

Only download Budget Ctrl from the Releases page.
[SECURITY.md](SECURITY.md#verifying-a-download) shows how to check that a
download is genuine.

### Linux

Also on [Releases](../../releases):

- **AppImage**, for most distributions:
  `chmod +x Budget.Ctrl_*_amd64.AppImage`, then run it.
- **.deb**, for Ubuntu, Debian and Mint:
  `sudo apt install ./Budget.Ctrl_*_amd64.deb`

On plain GNOME, the tray icon needs the *AppIndicator and KStatusNotifierItem
Support* extension.

### Good to know

- Closing the window doesn't quit the app. It stays in the tray so reminders
  still arrive. To quit, use the tray icon's menu.
- For reminders after a restart, turn on **Start with Windows** in Settings.
- The app updates itself. It checks GitHub once a day and asks before
  installing anything. You can turn this off in **Settings → Updates**.
- Coming from 0.4.x? Uninstall it first (Windows Settings → Apps). That
  doesn't remove your budget, and the new version picks it up when it starts.
  If you install over 0.4.x instead, you'll have two separate copies.

What changed in each version is in the [changelog](CHANGELOG.md).

## Your data

Your budget lives in one file in the app's data folder. **Settings → Data** has
backups, restoring, and export to a spreadsheet, and the app keeps daily
backups of its own.

## What it can't do yet

- There's no macOS version. Signing one so it opens without warnings needs a
  paid Apple developer account.
- It works in one currency at a time and doesn't convert between them.
- Clicking a reminder opens the app on Windows only. On Linux it's a plain
  notification.

## Feedback

Found a bug or have an idea? Use **Report a problem** or **Suggest an idea** in
**Settings → About**, or open an [issue](../../issues). To report a security
problem privately, see [SECURITY.md](SECURITY.md).

## Building it yourself

You'll need Node.js 20.19 or newer, and Rust with the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Then:

```bash
npm install
npm run tauri:dev
```

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the rest: the other commands,
how the app is put together, and how releases are made.

## Code signing policy

Windows releases are being set up for code signing through the SignPath
Foundation, so that Windows knows who published the installer. Until that is in
place, the Windows installer is unsigned, and SmartScreen may show "Windows
protected your PC". Click **More info → Run anyway**.

Free code signing provided by [SignPath.io](https://signpath.io), certificate
by [SignPath Foundation](https://signpath.org).

**What gets signed.** Only the Windows installer and the Budget Ctrl program
inside it, both built from the source code in this repository. Budget Ctrl is
MIT licensed and contains no proprietary components; the libraries it is built
from are open source too. Nothing from any other project is signed.

**How releases are built.** By the [Release workflow](.github/workflows/release.yml)
on GitHub-hosted runners, from a tagged commit, after the full test suite
passes. Nothing is built or signed on a personal computer. Every signing
request is approved by hand, and a release only becomes public, and reaches the
in-app updater, when the maintainer publishes it after checking its files.

**Team roles.**

| Role | Who |
|---|---|
| Committer | [CptMeowgi](https://github.com/CptMeowgi) |
| Reviewer | [CptMeowgi](https://github.com/CptMeowgi) |
| Approver | [CptMeowgi](https://github.com/CptMeowgi) |

Changes from anyone else are reviewed by a committer before they are merged.
Everyone with commit or signing access must use multi-factor authentication.

**Privacy.** Budget Ctrl sends none of your data anywhere. The only connection
it makes is to GitHub, to check for updates (once a day, which you can turn
off in **Settings → Updates**) and to download an update when you choose to
install one. Those requests are covered by
[GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
[SECURITY.md](SECURITY.md#how-budget-ctrl-handles-your-data) has the details.

If you think a signed file is wrong or harmful, please report it as described
in [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE).
