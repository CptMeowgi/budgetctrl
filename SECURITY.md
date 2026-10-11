# Security policy

Budget Ctrl holds people's finances, so security problems get priority over
everything else. Thank you for taking the time to report one.

## Supported versions

Only the latest release gets security fixes. From 0.5.0 on, the app updates
itself, so a fix reaches everyone who accepts the update.

| Version | Supported |
|---|---|
| 0.5.x (latest) | Yes |
| 0.4.x and earlier | No. These can't update themselves; install the latest release |

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Report it
privately instead:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the problem: what an attacker could do, the version and operating
   system, and the steps to reproduce it. A proof of concept helps, but please
   don't include anyone's real financial data.

You'll get a reply within a week. Budget Ctrl is maintained by one person, so
please allow time for a fix before sharing details publicly. Once it's fixed
and released, you're welcome to publish your findings, and you'll be credited
in the release notes unless you'd rather not be.

## What's in scope

- Anything that lets someone read or change a budget without the owner's
  consent
- The update mechanism: anything that could get an unsigned or tampered
  update installed
- The `budgetctrl://` link the app registers, and bank statement (CSV) and
  backup file imports
- The PIN lock, beyond its documented limits below
- The release pipeline in `.github/workflows/`, which holds the signing key

## What isn't

- The documented limits of the PIN lock (see below)
- Attacks that need someone already in control of your user account, or
  malware already running on your computer
- Versions older than the latest release
- Vulnerabilities in dependencies that don't affect Budget Ctrl. Please report
  those to the dependency's own project, and tell us if Budget Ctrl is affected

## How Budget Ctrl handles your data

- **It stays on your computer.** The budget is one JSON file in the app's data
  folder (`%APPDATA%\com.budget-ctrl.app` on Windows,
  `~/.local/share/com.budget-ctrl.app` on Linux), with rolling backups beside
  it and a copy in the app's own web storage as a fallback. There is no account
  and no server.
- **The only network access is updates.** Once a day the app asks GitHub
  whether a new version exists, and it downloads one only when you click
  install. No budget data is sent. The daily check can be turned off in
  **Settings → Updates**.
- **Updates are signed.** Every installer is signed with the project's private
  key, and the app refuses any update whose signature doesn't match the public
  key built into it.
- **The PIN is never stored.** Only a salted PBKDF2-SHA256 hash of it is kept,
  with 150,000 iterations, in a separate `lock.json` file.

### Limits to know about

- **The PIN lock is a privacy screen, not encryption.** It stops someone else
  at your computer from opening the app, but the budget file itself isn't
  encrypted. Anyone who can read files in your user account can read it, and
  deleting `lock.json` removes the lock (that's the documented way back in if
  you forget your PIN). Use your operating system's account password and disk
  encryption to protect the file itself.
- **The Windows installer isn't code-signed yet**, so Windows SmartScreen may
  warn you when you run it. Only download Budget Ctrl from this repository's
  [Releases](../../releases) page.

## Verifying a download

Each installer on the Releases page comes with a `.sig` file, the same
signature the app checks before installing an update. To check one by hand
with [minisign](https://jedisct1.github.io/minisign/):

```bash
# The .sig file is base64-encoded; decode it first
base64 -d "Budget.Ctrl_0.5.1_x64-setup.exe.sig" > installer.minisig
minisign -Vm "Budget.Ctrl_0.5.1_x64-setup.exe" -x installer.minisig \
  -P RWSFE/K+9Rg6NtVsvfsTSbkCKeYdov1+ua17Z2v+G6zTQvNitMzdtJ2O
```

The public key above (ID `363A18F5BEF21385`) is the same one in
[`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json). If the check fails,
don't run the file, and please report it.
