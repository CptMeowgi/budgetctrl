import { isTauri } from "./platform.js";
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

async function readStoreFile() {
  const { fs, base } = await fsApi();
  if (!(await fs.exists(STORE_FILE, { baseDir: base }))) return null;
  const text = await fs.readTextFile(STORE_FILE, { baseDir: base });
  if (!text || !text.trim()) return null;
  // Parse-check before handing it back. A truncated or corrupted file would
  // otherwise be returned happily, fail to parse in the caller, and present as
  // an empty app while the real data still sat in localStorage.
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !parsed.months) return null;
  } catch {
    return null;
  }
  return text;
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
  const stamp = new Date();
  const day = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
  const name = `${BACKUP_DIR}/budget-ctrl-${day}${tag ? `-${tag}` : ""}.json`;
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
// destructive. Writing one on every keystroke would be noise.
async function maybeDailyBackup(text) {
  const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
  let last = null;
  try { last = localStorage.getItem(LAST_BACKUP_KEY); } catch { /* unavailable */ }
  if (last === today) return;
  try {
    await writeBackup(text);
    try { localStorage.setItem(LAST_BACKUP_KEY, today); } catch { /* unavailable */ }
  } catch { /* a failed backup must never block a save */ }
}

if (!window.storage) {
  window.storage = {
    get: async (key) => {
      if (isTauri) {
        try {
          const fromFile = await readStoreFile();
          if (fromFile) return { value: fromFile };
          // First run after upgrading: adopt whatever localStorage already
          // holds and write it to the file. localStorage is deliberately left
          // in place as a fallback rather than cleared.
          const legacy = localStorage.getItem(key);
          if (legacy) {
            try { await writeStoreFile(legacy); } catch { /* retried next save */ }
            return { value: legacy };
          }
          return null;
        } catch (err) {
          noteStorageFault("read", err);
          const val = localStorage.getItem(key);
          return val ? { value: val } : null;
        }
      }
      const val = localStorage.getItem(key);
      return val ? { value: val } : null;
    },
    set: async (key, value) => {
      if (isTauri) {
        try {
          await writeStoreFile(value);
          await maybeDailyBackup(value);
          // Mirrored to localStorage so a future read still finds the data if
          // the file is ever lost or unreadable.
          try { localStorage.setItem(key, value); } catch { /* quota */ }
          return { key, value };
        } catch (err) {
          noteStorageFault("write", err);
          localStorage.setItem(key, value);
          return { key, value };
        }
      }
      localStorage.setItem(key, value);
      return { key, value };
    },
  };
}
