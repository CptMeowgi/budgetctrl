# Phase 3 — Tauri desktop packaging + GitHub setup — Design

**Date:** 2026-04-09
**Scope:** Wrap the existing Vite + React single-file app as a native Windows desktop application using Tauri v2, producing an installable .msi. No frontend code changes. Also initialise the local directory as a git repository and push to `git@github.com:CptMeowgi/budgetctrl.git`.

## Goals

1. Ship a double-clickable Windows installer for the app.
2. Run the app as a native window with no browser chrome, offline.
3. Preserve all existing data (localStorage) without migration.
4. Get the project under version control and onto GitHub.

## Decisions

| # | Decision | Chosen option |
|---|---|---|
| 1 | Framework | Tauri v2 (Rust + system WebView2) |
| 2 | Target platforms | Windows only (.msi) |
| 3 | Data persistence | Keep localStorage as-is; no migration to file APIs |
| 4 | Updates | Manual via GitHub releases (no auto-updater) |
| 5 | Polish level | Minimal: default Tauri icons, standard window chrome, no tray |
| 6 | Remote | `git@github.com:CptMeowgi/budgetctrl.git` via SSH |

## Design

### 1. Prerequisites (one-time, on this machine)

Must exist before `npm run tauri:build` can succeed:

- **Rust toolchain**. Install via `rustup` from https://rustup.rs. Stable channel is sufficient. `cargo --version` must succeed in a fresh shell after install.
- **Microsoft Visual Studio C++ Build Tools** with the "Desktop development with C++" workload. Required by Rust's MSVC linker on Windows. If you already have VS 2019/2022 installed with that workload, nothing to do.
- **WebView2 runtime**. Pre-installed on Windows 11; no action needed.

These are user-driven installs (interactive GUIs, admin prompts, multi-GB downloads). The implementation plan will pause and wait for the user to confirm completion before continuing.

### 2. Tauri scaffolding

NPM-level:
```
npm install --save-dev @tauri-apps/cli@^2
```
(No `@tauri-apps/api` — the frontend makes no Tauri API calls since we're keeping localStorage.)

Then run `npx tauri init` with answers:

| Prompt | Answer |
|---|---|
| App name | `budget-ctrl` |
| Window title | `Budget Ctrl` |
| Web assets location (frontendDist) | `../dist` |
| Dev server URL (devUrl) | `http://localhost:5173` |
| Frontend dev command | `npm run dev` |
| Frontend build command | `npm run build` |

This creates `src-tauri/` containing:
- `Cargo.toml`, `Cargo.lock` — Rust deps
- `src/main.rs` — default entry point; no custom code needed
- `build.rs` — Tauri build script
- `tauri.conf.json` — configured via Section 3
- `icons/` — default placeholder icons (kept as-is for minimal polish)
- `capabilities/default.json` — Tauri v2 capabilities; defaults fine

**package.json scripts:**
```json
"tauri": "tauri",
"tauri:dev": "tauri dev",
"tauri:build": "tauri build"
```

**`.gitignore` additions:**
```
src-tauri/target/
.claude/
```
(`src-tauri/target/` holds multi-GB Rust build artifacts. `.claude/` holds local preview-MCP launch config, not shared.)

**Commit `Cargo.lock`** — pins Rust dep versions for reproducible builds.

### 3. `tauri.conf.json` tweaks

After `tauri init`, overwrite the relevant fields:

```json
{
  "productName": "Budget Ctrl",
  "version": "0.1.0",
  "identifier": "com.budget-ctrl.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "title": "Budget Ctrl",
      "width": 1280,
      "height": 800,
      "minWidth": 1024,
      "minHeight": 700,
      "resizable": true,
      "center": true
    }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["msi"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

Rationale:
- `targets: ["msi"]` — Windows MSI installer. Clean uninstall path via "Add or remove programs".
- `csp: null` — React inline styles and dev-mode injections break strict CSPs; the app is fully offline so CSP adds little security.
- `minWidth: 1024, minHeight: 700` — prevents the user shrinking below the dashboard's desktop layout (responsive is explicitly out of scope).
- `identifier: com.budget-ctrl.app` — reverse-DNS unique ID used by Windows to register the app.

### 4. Dev + build workflow

**Dev iteration:**
```
npm run tauri:dev
```
Spawns Vite dev server, then opens a native Tauri window pointed at `http://localhost:5173`. HMR works. First run compiles all Rust deps (~5-10 min); subsequent runs are ~10-30s.

The existing `npm run dev` still works for browser-based testing, so the Claude Preview MCP workflow is untouched.

**Production build:**
```
npm run tauri:build
```
Runs `npm run build` → `cargo build --release` → `tauri bundle`. Output:

```
src-tauri/target/release/bundle/msi/Budget Ctrl_0.1.0_x64_en-US.msi
```

Approx 5-10 MB. First build: ~8-15 min. Subsequent: ~1-2 min.

**Distribution:** manually upload the `.msi` to a GitHub release. Users download and double-click; standard Windows installer wizard runs; installed app appears in Start menu as "Budget Ctrl".

**SmartScreen caveat:** unsigned MSIs trigger "Windows protected your PC" on first run. Users click "More info" → "Run anyway". Code signing is ~$200/yr and out of scope.

**Data persistence:** the webview's localStorage lives at
```
%APPDATA%\com.budget-ctrl.app\EBWebView\Default\Local Storage\...
```
Persists across app launches. Preserved across version upgrades when installing over the top. Wiped only by full uninstall with "remove user data" checked.

### 5. Git + GitHub setup

The directory is currently not a git repository. This phase initialises it and pushes to the user-provided remote.

**Remote:** `git@github.com:CptMeowgi/budgetctrl.git` (SSH)

**Safety-first workflow:**

1. `git init` in the project root.
2. `git remote add origin git@github.com:CptMeowgi/budgetctrl.git`.
3. **`git fetch origin`** — check if the remote already has commits. This is the critical safety step.
4. If `git ls-remote origin` returns no refs → remote is empty, safe to push.
   If refs exist → STOP, surface the state to the user, and ask how to proceed (rebase local onto remote, reset local to remote, force-push, etc.). Do NOT auto-resolve.
5. Stage files. Since this is a first commit of a non-empty directory, use explicit patterns to avoid accidentally committing things we shouldn't:
   - Include: `src/`, `public/`, `docs/`, `package.json`, `package-lock.json`, `vite.config.js`, `eslint.config.js`, `index.html`, `README.md`, `.gitignore`, `start.bat`, `src-tauri/` (minus `target/`)
   - Explicitly exclude (already in `.gitignore`): `node_modules/`, `dist/`, `src-tauri/target/`, `.claude/`
   - Also exclude the stray `New Text Document.txt` — it's an empty file with no purpose. Delete it from disk as part of this phase.
6. First commit message: `Initial commit — budget-ctrl desktop budget tracker` with a short body summarising Phase 1 → Phase 3 work.
7. `git branch -M main` to ensure the default branch is `main`.
8. `git push -u origin main` — only after the safety check passed.

**Git identity:** must be configured before committing. Check `git config --global user.email` and `git config --global user.name`. If missing, the implementation plan pauses and asks the user to set them.

**SSH key:** the user is pushing via SSH so they must already have an SSH key on their GitHub account. If `ssh -T git@github.com` fails the auth test, the plan pauses and asks.

### 6. Verification

End-to-end success criteria:

1. `cargo --version` succeeds in a fresh shell.
2. `npx tauri --version` succeeds (Tauri CLI installed).
3. `npm run tauri:dev` opens a native Tauri window showing the Dashboard. Editing `src/App.jsx` hot-reloads the window.
4. `npm run tauri:build` produces an `.msi` file.
5. Installing that `.msi` succeeds (installer wizard completes).
6. Launching "Budget Ctrl" from Start menu opens the app.
7. Seeding data → closing app → reopening → data persists.
8. Uninstalling via "Add or remove programs" succeeds.
9. `git log --oneline` shows the initial commit.
10. `git push` succeeds and the commit is visible on `github.com/CptMeowgi/budgetctrl`.

Steps 3-8 require real builds that take minutes and can't be driven by Claude Preview MCP. The implementation plan's final task is a **manual verification checklist** — each step is a command the user runs and reports the outcome.

## Files touched

- Modify: `package.json` (scripts + devDep)
- Modify: `.gitignore` (add `src-tauri/target/`, `.claude/`)
- Delete: `New Text Document.txt` (stray empty file)
- Create: `src-tauri/` (entire directory, auto-generated then configured)
- Edit: `src-tauri/tauri.conf.json` (post-generation)
- Create: `docs/plans/2026-04-09-phase3-design.md` (this doc)
- Create: `docs/plans/2026-04-09-phase3.md` (implementation plan, next step)

**No changes to `src/App.jsx`.** Zero frontend work this phase.

## Non-goals

- macOS / Linux builds → Phase 4+
- Auto-updater (Tauri updater plugin, signing keys, update manifests) → Phase 4+
- Code signing / Authenticode certificates → out of scope
- Custom window chrome, draggable title bar, borderless window → out of scope
- System tray icon, minimize-to-tray, start-on-boot → out of scope
- Migrating from localStorage to file-based persistence → not needed
- Custom icon design → defaults from `tauri init` are fine
- CI/CD via GitHub Actions → Phase 4+
- Export/import data backup UI → not this phase
- Tauri JS API calls (`@tauri-apps/api`) → not needed
