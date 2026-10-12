import { isTauri } from "./platform.js";
import { backupName, isBudgetText, serial } from "./lib/backups.js";
/* ---- Storage -------------------------------------------------------------
   Everything lives in one JSON document. In the browser that is localStorage;
   in the desktop app it is a real file under the OS app-data directory.

   The move off localStorage matters because a webview's storage is not durable
   - the OS may evict it under disk pressure, and clearing browser data for the
   WebView2 runtime takes it with it. Losing a year of finances that way is not
   an acceptable failure mode, and a file is also something you can copy, sync
   or inspect yourself.

   Kept behind the same tiny async get/set the app already used, so the app code
   above does not know or care which backing store it has. */

const STORE_FILE = "budget-ctrl.json";
const BACKUP_DIR = "backups";
const KEEP_BACKUPS = 14;
const LAST_BACKUP_KEY = "budget-ctrl-last-backup";

// Set when the file store is unreachable, so the failure is reportable instead
// of being hidden by the localStorage fallback.
let storageFault = null;
export function getStorageFault() {
  return storageFault;
}

function noteStorageFault(where, err) {
  storageFault = `${where}: ${err && err.message ? err.message : String(err)}`;
  console.warn("[budget-ctrl] file storage unavailable —", storageFault);
}

async function fsApi() {
  const fs = await import("@tauri-apps/plugin-fs");
  return { fs, base: fs.BaseDirectory.AppData };
}

// The app lock lives in its own small file beside the budget, not inside it:
// a backup carried to another computer should not arrive locked, and deleting
// this one file is the documented way out of a forgotten PIN.
export const LOCK_FILE = "lock.json";
const LOCK_KEY = "budget-ctrl-lock";

export async function readLock() {
  try {
    if (isTauri) {
      const { fs, base } = await fsApi();
      if (!(await fs.exists(LOCK_FILE, { baseDir: base }))) return null;
      return JSON.parse(await fs.readTextFile(LOCK_FILE, { baseDir: base }));
    }
    return JSON.parse(localStorage.getItem(LOCK_KEY) || "null");
  } catch {
    // An unreadable lock opens the app rather than shutting you out of it.
    return null;
  }
}

export async function writeLock(lock) {
  if (isTauri) {
    const { fs, base } = await fsApi();
    await ensureStoreDir();
    if (lock) await fs.writeTextFile(LOCK_FILE, JSON.stringify(lock), { baseDir: base });
    else if (await fs.exists(LOCK_FILE, { baseDir: base })) await fs.remove(LOCK_FILE, { baseDir: base });
    return;
  }
  if (lock) localStorage.setItem(LOCK_KEY, JSON.stringify(lock));
  else localStorage.removeItem(LOCK_KEY);
}

// What the budget file holds: { status: "missing" }, { status: "ok", text },
// or { status: "unreadable", text } for a file that is there but truncated or
// corrupted - which must never be mistaken for "no budget yet".
async function readStoreFile() {
  const { fs, base } = await fsApi();
  if (!(await fs.exists(STORE_FILE, { baseDir: base }))) return { status: "missing" };
  const text = await fs.readTextFile(STORE_FILE, { baseDir: base });
  if (!text || !text.trim()) return { status: "unreadable", text: text || "" };
  return isBudgetText(text) ? { status: "ok", text } : { status: "unreadable", text };
}

// Keep an unreadable budget file before anything can replace it, beside the
// budget and out of the backups folder so pruning never removes it. Returns
// the copy's name, or null if it could not be written.
export async function setAsideUnreadable(text) {
  if (!isTauri) return null;
  const name = backupName(new Date(), "unreadable");
  try {
    const { fs, base } = await fsApi();
    await fs.writeTextFile(name, text, { baseDir: base });
    return name;
  } catch (err) {
    noteStorageFault("set aside", err);
    return null;
  }
}

// Thrown when the budget can't be read and there is nothing safe to fall back
// on. The app shows a recovery screen rather than starting a fresh budget that
// the first edit would save over the real one.
export class BudgetUnreadableError extends Error {
  constructor(keptAs) {
    super("The budget file could not be read");
    this.keptAs = keptAs;
  }
}

// Write to a temporary file and move it into place, so a crash or power loss
// mid-write leaves the previous document intact rather than a truncated one.
// The app-data directory does not exist on a clean machine and writeTextFile
// will not create a missing parent, so the very first save would fail. Creating
// the backups folder recursively makes both it and its parent.
async function ensureStoreDir() {
  const { fs, base } = await fsApi();
  try {
    await fs.mkdir(BACKUP_DIR, { baseDir: base, recursive: true });
  } catch (err) {
    // "already exists" is fine; anything else is a real fault worth seeing.
    if (!/exist/i.test(String(err))) noteStorageFault("mkdir", err);
  }
}

async function writeStoreFile(text) {
  const { fs, base } = await fsApi();
  await ensureStoreDir();
  await fs.writeTextFile(STORE_FILE, text, { baseDir: base });
  // Read back rather than trust the call. The previous temp-file-and-rename
  // version reported success while leaving no file behind, and a write that
  // silently no-ops is indistinguishable from one that worked. Crash safety is
  // already covered by the daily backups and the localStorage mirror, so the
  // rename was complexity buying nothing.
  if (!(await fs.exists(STORE_FILE, { baseDir: base }))) {
    throw new Error("write reported success but the file does not exist");
  }
}

export async function writeBackup(text, tag) {
  const { fs, base } = await fsApi();
  await ensureStoreDir();
  const name = `${BACKUP_DIR}/${backupName(new Date(), tag || "daily")}`;
  await fs.writeTextFile(name, text, { baseDir: base });
  await pruneBackups();
  return name;
}

export async function listBackups() {
  if (!isTauri) return [];
  try {
    const { fs, base } = await fsApi();
    if (!(await fs.exists(BACKUP_DIR, { baseDir: base }))) return [];
    const entries = await fs.readDir(BACKUP_DIR, { baseDir: base });
    return entries
      .filter((e) => e.isFile && e.name.endsWith(".json"))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

async function pruneBackups() {
  try {
    const { fs, base } = await fsApi();
    const all = await listBackups();
    for (const name of all.slice(KEEP_BACKUPS)) {
      try { await fs.remove(`${BACKUP_DIR}/${name}`, { baseDir: base }); } catch { /* best effort */ }
    }
  } catch { /* pruning is housekeeping, never fatal */ }
}

export async function readBackup(name) {
  const { fs, base } = await fsApi();
  return await fs.readTextFile(`${BACKUP_DIR}/${name}`, { baseDir: base });
}

// One backup per calendar day, plus an explicit one before anything
// destructive. Writing one on every keystroke would be noise. It is taken
// before the day's first change is written, so it holds the budget as the
// last session left it - not the state after that first change.
async function maybeDailyBackup() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  let last = null;
  try { last = localStorage.getItem(LAST_BACKUP_KEY); } catch { /* unavailable */ }
  if (last === today) return;
  try {
    const current = await readStoreFile();
    if (current.status === "ok") await writeBackup(current.text, "daily");
    try { localStorage.setItem(LAST_BACKUP_KEY, today); } catch { /* unavailable */ }
  } catch { /* a failed backup must never block a save */ }
}

// Saving writes the whole file, so writes go one at a time, in order: two in
// flight at once could finish in either order and leave an older budget on
// disk. Inputs that save on every keystroke made that likely.
const saveToFile = serial(async (key, value) => {
  try {
    await maybeDailyBackup();
    await writeStoreFile(value);
    // Mirrored to localStorage so a future read still finds the data if
    // the file is ever lost or unreadable.
    try { localStorage.setItem(key, value); } catch { /* quota */ }
  } catch (err) {
    noteStorageFault("write", err);
    localStorage.setItem(key, value);
  }
  return { key, value };
});

if (!window.storage) {
  window.storage = {
    get: async (key) => {
      if (isTauri) {
        let file;
        try {
          file = await readStoreFile();
        } catch (err) {
          noteStorageFault("read", err);
          const val = localStorage.getItem(key);
          return val ? { value: val } : null;
        }
        if (file.status === "ok") return { value: file.text };
        const keptAs = file.status === "unreadable" ? await setAsideUnreadable(file.text) : null;
        // First run after upgrading from localStorage, or a damaged file: adopt
        // the copy localStorage mirrors and write it to the file. localStorage
        // is deliberately left in place as a fallback rather than cleared.
        const legacy = localStorage.getItem(key);
        if (isBudgetText(legacy)) {
          try { await writeStoreFile(legacy); } catch { /* retried next save */ }
          return { value: legacy };
        }
        // Never "no budget yet" for a file that is there: the app would start
        // a fresh one and save it over the damaged file.
        if (file.status === "unreadable") throw new BudgetUnreadableError(keptAs);
        return null;
      }
      const val = localStorage.getItem(key);
      return val ? { value: val } : null;
    },
    set: async (key, value) => {
      if (isTauri) return saveToFile(key, value);
      localStorage.setItem(key, value);
      return { key, value };
    },
  };
}
