# Developing Budget Ctrl

How to run the app from source, how it's put together, and how releases are
made.

## Running from source

You need [Node.js](https://nodejs.org) 20.19+ or 22.12+ and the
[Rust toolchain](https://www.rust-lang.org/tools/install) with the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). On Windows
that's the Microsoft C++ Build Tools and WebView2. On Ubuntu it's
`libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev`.

```bash
npm install
npm run tauri:dev
```

| Command | What it does |
|---|---|
| `npm run tauri:dev` | The desktop app with hot reload |
| `npm run dev` | Browser only, at `localhost:5173`. No tray, reminders or window chrome |
| `npm run tauri:build` | A signed installer in `src-tauri/target/release/bundle/nsis/` (needs the signing key, see below) |
| `npm run build` | The web assets only |
| `npm run lint` | ESLint |
| `npm test` | The unit tests (Vitest) |
| `npm run licenses` | Rebuilds the open-source licence list shown in Settings. Run it after adding or updating a dependency, once `npm ci` and `cargo fetch --locked` (in `src-tauri`) have run. A test fails until you do |

In the browser, add `?demo` to the address to open a made-up budget instead of
yours. It lives in memory only, so nothing you try there is saved. More options:
`&tab=reports`, `&theme=light`, `&lang=pl`, `&pay=fortnightly`, and
`&whatsnew` to show the "What's new" window.

Notifications need the installed app. Windows attributes a notification to the
Start Menu shortcut that only the installer creates, so they may not appear
under `tauri:dev`.

## How it's built

```
src/App.jsx          the app shell and the tab views
src/components/      dialogs and views (Settings, Reports, Accounts, ...)
src/lib/             the budget logic, with tests beside each file
src/locales/         the translations, one file per language
src-tauri/src/lib.rs tray, close-to-tray, autostart, reminders, window lifecycle
```

React 19 and Vite on the front, Tauri v2 underneath, Recharts for the charts.
There's no component library or CSS framework: the styling is a set of tokens
in `src/theme.js` (colours for both themes, type, radii, spacing) used through
inline styles. The font, DM Sans, is bundled rather than fetched.

The reminder checker runs in JavaScript, not Rust. Working out periods, the
real date a bill falls on and what counts as due is fiddly, and a second copy
in Rust would drift from the one the screen uses. Hiding a Tauri window
doesn't stop its webview, so the app sitting in the tray *is* the background
process, running the same code as the screen.

Rust handles the shell: the tray icon and its menu, turning a window close into
a hide, registering autostart, and the `--hidden` flag that lets a launch at
login start quietly.

### Data

The whole budget is one JSON document: a file in the app's data folder on the
desktop, `localStorage` in a browser. It's keyed by budget period:

```
months: { "2026-09": { income, expenses[], recurring[], upcoming[], credits[] } }
recurringTemplate[], creditTemplate[], categories[], creditCategories[], categoryGroups[]
goals[], accounts[], importRules[], importLayouts[], savingsGoal
cutoffDay, paySchedule[]?, currency, locale, language, reminders, updates
```

A monthly period is keyed by the calendar month it starts in, so changing the
payday doesn't break existing keys. A budget that switches to weekly or
fortnightly pay gets a `paySchedule`. From the switch on, each period is keyed
by its first day (`"2026-11-06"`), so periods still sort by date and earlier
months keep their keys.

Every way a budget comes in (loading, restoring a backup, starting again) runs
it through `hydrate()`, so a format change needs a migration in one place.
`src/fixtures/` holds budgets exactly as earlier versions saved them, and the
tests check each one still opens unchanged.

## Releases

What's in each version is in the [changelog](../CHANGELOG.md).

Releases are built by GitHub Actions ([release.yml](../.github/workflows/release.yml)):
the Windows installer, the Linux AppImage and .deb, and `latest.json` for the
updater.

To check a change builds on both systems first, run **Test build**
([build.yml](../.github/workflows/build.yml)) from the Actions tab. It builds
unsigned installers and keeps them with the run for a week, without releasing
anything.

To publish a release:

1. In `CHANGELOG.md`, rename `## Unreleased` to the new version, e.g. `## 0.7.0`.
   That section becomes the release notes and the app's "What's new" text.
2. Set the same version in `src-tauri/tauri.conf.json`.
3. Commit, then tag and push the tag: `git tag 0.7.0` and `git push origin 0.7.0`.
4. Actions runs the tests, builds the signed installers and `latest.json`, and
   opens a **draft** release. Check it and press **Publish**. Installed copies
   offer the update within a day.

The build fails if the tag doesn't match the version in `tauri.conf.json` or the
changelog has no section for it. A test also fails if the version has no
changelog section.

### Screenshots

The README's screenshots come from the made-up budget. With `npm run dev`
running, headless Edge or Chrome can save one, for example:

```
msedge --headless --force-prefers-reduced-motion --window-size=1440,900 --screenshot=docs/screenshots/reports.png "http://localhost:5173/?demo&tab=reports"
```

### The signing key

Every update is signed. The public key is in `tauri.conf.json`. The private key
and its password are held by the maintainer, and only reach GitHub as the
repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **If the private key is lost, installed
copies can never be updated again**, so keep a backup of it.

To build an installer locally, set those two environment variables to the key
and its password before `npm run tauri:build`.
