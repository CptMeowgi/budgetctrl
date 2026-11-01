import { isTauri } from "./platform.js";
import { backupName, isBudgetText, serial } from "./lib/backups.js";
import { STORAGE_KEY } from "./model.js";
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
async function ensureDir(path) {
  const { fs, base } = await fsApi();
  try {
    await fs.mkdir(path, { baseDir: base, recursive: true });
  } catch (err) {
    // "already exists" is fine; anything else is a real fault worth seeing.
    if (!/exist/i.test(String(err))) noteStorageFault("mkdir", err);
  }
}

const ensureStoreDir = () => ensureDir(BACKUP_DIR);

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

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// One backup per calendar day, plus an explicit one before anything
// destructive. Writing one on every keystroke would be noise. It is taken
// before the day's first change is written, so it holds the budget as the
// last session left it - not the state after that first change.
async function maybeDailyBackup() {
  const today = dayKey(new Date());
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

/* ---- Own budget files -----------------------------------------------------
   A person's own budget is a file of its own, own-<personId>.json, beside the
   budget file. It is kept as carefully as the budget file: the unreadable-file
   protection, a daily backup, a localStorage mirror, and saves that go one at
   a time. Its backups sit in a folder per person (backups/own-<personId>/), so
   pruning the budget file's backups never counts or removes them. Only these
   functions, and budgetStore.js through them, read or write those files.

   The app's file permissions have no rename, so every "move" here is a write,
   checked by reading it back, and then a remove. A crash between the two
   leaves the data in both places rather than in neither. */

// Lowercase only: own-A.json and own-a.json are one file on Windows and two on
// Linux, so a second spelling of an id could share someone else's file.
const PERSON_ID = /^[a-z0-9]{1,40}$/;
const OWN_FILE = /^own-([a-z0-9]{1,40})\.json$/;
// A backup is named by backupName() and handed back by a listing, so anything
// with a slash or a ".." in it is not one of ours.
const BACKUP_FILE = /^[\w.-]+\.json$/;

export function validPersonId(id) {
  return typeof id === "string" && PERSON_ID.test(id);
}

export function ownFileName(pid) {
  if (!validPersonId(pid)) throw new Error("That is not an id an own budget file can be named after");
  return `own-${pid}.json`;
}

const ownDir = (pid) => `${BACKUP_DIR}/own-${pid}`;

const stamp = (at) => {
  const two = (n) => String(n).padStart(2, "0");
  return `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}`;
};
// own-a-removed-20261027-1432.json: the minute it was set aside, so they sort
// in the order they were made.
const ownCopyName = (pid, why, at) => `own-${pid}-${why}-${stamp(at)}.json`;

// localStorage holds each own file's mirror in the app, and the file itself in
// the browser: own-a.json is the key budget-app-data:own-a.
const keyOf = (file) => `${STORAGE_KEY}:${file.replace(/\.json$/, "")}`;
const mirrorGet = (file) => { try { return localStorage.getItem(keyOf(file)); } catch { return null; } };
const mirrorSet = (file, text) => { try { localStorage.setItem(keyOf(file), text); } catch { /* quota */ } };
const mirrorRemove = (file) => { try { localStorage.removeItem(keyOf(file)); } catch { /* unavailable */ } };

// Read back rather than trust the call, as writeStoreFile does.
async function writeVerified(path, text) {
  const { fs, base } = await fsApi();
  await fs.writeTextFile(path, text, { baseDir: base });
  let back = null;
  try { back = await fs.readTextFile(path, { baseDir: base }); } catch { /* reported below */ }
  if (back !== text) throw new Error(`${path} does not hold what was written to it`);
}

async function removeIfThere(path) {
  const { fs, base } = await fsApi();
  if (await fs.exists(path, { baseDir: base })) await fs.remove(path, { baseDir: base });
}

// The files beside the budget file: real files in the app, localStorage keys
// in the browser.
const appFiles = isTauri
  ? {
      async list() {
        const { fs, base } = await fsApi();
        // On a clean machine nothing has been saved, so there is no folder and
        // no files. Any other reason the folder can't be read is an error.
        if (!(await fs.exists("", { baseDir: base }))) return [];
        return (await fs.readDir("", { baseDir: base })).filter((e) => e.isFile).map((e) => e.name);
      },
      async exists(file) {
        const { fs, base } = await fsApi();
        return fs.exists(file, { baseDir: base });
      },
      async read(file) {
        const { fs, base } = await fsApi();
        return fs.readTextFile(file, { baseDir: base });
      },
      async write(file, text) {
        await ensureStoreDir();
        await writeVerified(file, text);
      },
      async remove(file) {
        const { fs, base } = await fsApi();
        await fs.remove(file, { baseDir: base });
      },
    }
  : {
      async list() {
        const prefix = `${STORAGE_KEY}:`;
        const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
        return keys.filter((k) => k && k.startsWith(prefix)).map((k) => `${k.slice(prefix.length)}.json`);
      },
      async exists(file) { return localStorage.getItem(keyOf(file)) !== null; },
      async read(file) { return localStorage.getItem(keyOf(file)); },
      async write(file, text) { localStorage.setItem(keyOf(file), text); },
      async remove(file) { localStorage.removeItem(keyOf(file)); },
    };

// Every job on one person's files runs after the one before it, whether it
// reads, saves or moves them, so a read always sees the saves asked for first.
const ownQueues = new Map();
function inOrder(pid, job) {
  ownFileName(pid);
  if (!ownQueues.has(pid)) ownQueues.set(pid, serial((fn) => fn()));
  return ownQueues.get(pid)(job);
}

// A copy of someone's budget is never written over another. The minute is the
// only part of its name that varies, so a second copy in the same minute takes
// the next free one: still eight digits, a dash and four, and still sorting in
// the order the copies were made.
async function freeCopyName(pid, why) {
  let at = new Date();
  for (;;) {
    const name = ownCopyName(pid, why, at);
    if (!(await appFiles.exists(name))) return name;
    at = new Date(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes() + 1);
  }
}

// Keeps a damaged file's text beside it. Reading the same damaged file again
// must not pile up identical copies, so an existing copy of the same text is
// the one kept; different damage is a different copy.
async function keepUnreadable(pid, text) {
  const mine = new RegExp(`^own-${pid}-unreadable-\\d{8}-\\d{4}\\.json$`);
  try {
    for (const f of (await appFiles.list()).filter((name) => mine.test(name)).sort()) {
      if ((await appFiles.read(f)) === text) return f;
    }
  } catch { /* can't tell, so keep another copy */ }
  const name = await freeCopyName(pid, "unreadable");
  await appFiles.write(name, text);
  return name;
}

// As readStoreFile: { status: "missing" }, { status: "ok", text } or
// { status: "unreadable", text }.
async function readOwnState(file) {
  if (!(await appFiles.exists(file))) return { status: "missing" };
  const text = await appFiles.read(file);
  return isBudgetText(text) ? { status: "ok", text } : { status: "unreadable", text: text || "" };
}

// Also says where the damaged copy was kept: { status: "unreadable", text,
// keptAs }, with keptAs null if it couldn't be.
async function readOwnNow(pid) {
  const file = ownFileName(pid);
  let state;
  try {
    state = await readOwnState(file);
  } catch (err) {
    // The file may be fine and just out of reach. Saying "missing" would let a
    // fresh budget be started over it, so it is unreadable, with no text.
    noteStorageFault("read", err);
    const kept = mirrorGet(file);
    return isBudgetText(kept) ? { status: "ok", text: kept } : { status: "unreadable", text: "", keptAs: null };
  }
  if (state.status === "ok") return state;
  let keptAs = null;
  if (state.status === "unreadable") {
    try {
      keptAs = await keepUnreadable(pid, state.text);
    } catch (err) {
      noteStorageFault("set aside", err);
    }
    // Without a copy of the damaged file, writing the mirror over it would
    // leave no record of what was there.
    if (keptAs === null) return { ...state, keptAs: null };
  }
  // The file is missing or damaged: adopt the copy localStorage mirrors and
  // write it back. (In the browser the mirror is the file, so it never
  // qualifies here.)
  const mirror = mirrorGet(file);
  if (isBudgetText(mirror)) {
    try { await appFiles.write(file, mirror); } catch { /* retried next save */ }
    return { status: "ok", text: mirror };
  }
  return state.status === "unreadable" ? { ...state, keptAs } : state;
}

export async function readOwnFile(pid) {
  return inOrder(pid, () => readOwnNow(pid));
}

async function ownBackupNames(pid) {
  const { fs, base } = await fsApi();
  if (!(await fs.exists(ownDir(pid), { baseDir: base }))) return [];
  const names = new Set();
  for (const e of await fs.readDir(ownDir(pid), { baseDir: base })) {
    if (!e.isFile) continue;
    if (e.name.endsWith(".json")) names.add(e.name);
    // replaceOwnBackup can be stopped with only the new copy left, still named .new.
    else if (e.name.endsWith(".json.new")) names.add(e.name.slice(0, -".new".length));
  }
  return [...names].sort().reverse();
}

async function pruneOwnBackups(pid) {
  try {
    for (const name of (await ownBackupNames(pid)).slice(KEEP_BACKUPS)) {
      for (const path of [`${ownDir(pid)}/${name}`, `${ownDir(pid)}/${name}.new`]) {
        try { await removeIfThere(path); } catch { /* best effort */ }
      }
    }
  } catch { /* pruning is housekeeping, never fatal */ }
}

// As maybeDailyBackup, on this person's own day, so the budget file's backup
// being done today never stands in for theirs.
async function maybeDailyOwnBackup(pid) {
  const today = dayKey(new Date());
  const marker = `${LAST_BACKUP_KEY}:own-${pid}`;
  let last = null;
  try { last = localStorage.getItem(marker); } catch { /* unavailable */ }
  if (last === today) return;
  try {
    const current = await readOwnState(ownFileName(pid));
    if (current.status === "ok") {
      await ensureDir(ownDir(pid));
      await writeVerified(`${ownDir(pid)}/${backupName(new Date(), "daily")}`, current.text);
      await pruneOwnBackups(pid);
    }
    try { localStorage.setItem(marker, today); } catch { /* unavailable */ }
  } catch { /* a failed backup must never block a save */ }
}

// Text that isn't a JSON object is refused before anything is touched: saved,
// it would read back as a damaged file.
const mustBeBudgetText = (text) => {
  if (typeof text !== "string" || !isBudgetText(text)) throw new Error("That is not a budget to save");
};

// Unlike the budget file's save, a failed write is thrown after it is noted:
// moving an entry between files must not take it out of the first until the
// second really has it. The mirror still gets the text.
export async function writeOwnFile(pid, text) {
  return inOrder(pid, async () => {
    const file = ownFileName(pid);
    mustBeBudgetText(text);
    if (!isTauri) return appFiles.write(file, text);
    try {
      await maybeDailyOwnBackup(pid);
      await appFiles.write(file, text);
      mirrorSet(file, text);
    } catch (err) {
      noteStorageFault("write", err);
      mirrorSet(file, text);
      throw err;
    }
  });
}

// Takes a person's file out of use without destroying it. Resolves to the
// copy's name, or null when there was nothing to keep.
export async function setAsideOwnFile(pid) {
  return inOrder(pid, async () => {
    const file = ownFileName(pid);
    // Read it as readOwnFile does first: a damaged file is copied to
    // -unreadable- and a good mirror is adopted. What comes back is what to
    // keep: the file's text, or the mirror's when the file was damaged. (Not
    // what is on disk now: the mirror may not have been written back.) If the
    // damage can't be kept, nothing is touched.
    const now = await readOwnNow(pid);
    // No file and no budget in the mirror: a leftover mirror is just cleared.
    if (now.status === "missing") {
      mirrorRemove(file);
      return null;
    }
    if (now.status === "unreadable" && now.keptAs === null) throw new Error("The damaged file could not be kept, so it was left where it is");
    const keptAs = await freeCopyName(pid, "removed");
    await appFiles.write(keptAs, now.text);
    const onDisk = await appFiles.exists(file);
    // Left behind, the mirror would bring the budget back as soon as anything
    // read the file and found it missing. When the file holds the same text it
    // goes first, so a stop between the two leaves the file for the next try
    // rather than a mirror to resurrect it. When the file holds something else
    // (damaged, and the mirror couldn't be written over it) the mirror stays
    // until the file is really gone, so a file that won't go leaves it untouched.
    const same = onDisk && (await appFiles.read(file)) === now.text;
    if (same) mirrorRemove(file);
    if (onDisk) await appFiles.remove(file);
    if (!same) mirrorRemove(file);
    return keptAs;
  });
}

// Brings the newest set-aside copy back as the person's file. False when there
// is none, or when a file is already there: that is newer than any copy.
export async function restoreSetAsideOwnFile(pid) {
  return inOrder(pid, async () => {
    const file = ownFileName(pid);
    if (await appFiles.exists(file)) return false;
    const aside = new RegExp(`^own-${pid}-removed-\\d{8}-\\d{4}\\.json$`);
    const newest = (await appFiles.list()).filter((f) => aside.test(f)).sort().pop();
    if (!newest) return false;
    const text = await appFiles.read(newest);
    await appFiles.write(file, text);
    mirrorSet(file, text);
    try {
      await appFiles.remove(newest);
    } catch (err) {
      // The file is back, which is what was asked for. The leftover copy only
      // means a later restore finds it first, so it is noted, not thrown.
      noteStorageFault("remove restored copy", err);
    }
    return true;
  });
}

// The person ids that have an own-<id>.json. Set-aside and unreadable copies,
// conflict copies and anything else are not own files. Empty only when there
// is no folder yet; if the folder can't be read it rejects, because an empty
// answer would pass for "nobody has an own file".
export async function listOwnFiles() {
  let files;
  try {
    files = await appFiles.list();
  } catch (err) {
    noteStorageFault("list own files", err);
    throw err;
  }
  const ids = new Set();
  for (const f of files) {
    const m = OWN_FILE.exec(f);
    if (m) ids.add(m[1]);
  }
  return [...ids].sort();
}

function ownBackupPath(pid, name) {
  ownFileName(pid);
  if (typeof name !== "string" || !BACKUP_FILE.test(name) || name.includes("..")) throw new Error("That is not the name of a backup");
  return `${ownDir(pid)}/${name}`;
}

// There are no backups outside the app, as with the budget file's.
export async function listOwnBackups(pid) {
  return inOrder(pid, async () => {
    if (!isTauri) return [];
    try { return await ownBackupNames(pid); } catch { return []; }
  });
}

export async function readOwnBackup(pid, name) {
  return inOrder(pid, async () => {
    const path = ownBackupPath(pid, name);
    if (!isTauri) throw new Error("There are no backups outside the app");
    const { fs, base } = await fsApi();
    // The backup itself, unless a stop in the middle of replacing it left it
    // cut short and the .new copy whole (or left only the .new copy).
    let damaged = null;
    for (const candidate of [path, `${path}.new`]) {
      if (!(await fs.exists(candidate, { baseDir: base }))) continue;
      const text = await fs.readTextFile(candidate, { baseDir: base });
      if (isBudgetText(text)) return text;
      damaged ??= text;
    }
    if (damaged !== null) return damaged;
    throw new Error("There is no such backup");
  });
}

// Writes name.new, removes name, writes name, removes name.new. Stopped at any
// point, the whole new text is somewhere: listing and reading know to look for
// the .new copy.
export async function replaceOwnBackup(pid, name, text) {
  return inOrder(pid, async () => {
    const path = ownBackupPath(pid, name);
    mustBeBudgetText(text);
    if (!isTauri) return;
    await writeVerified(`${path}.new`, text);
    await removeIfThere(path);
    await writeVerified(path, text);
    await removeIfThere(`${path}.new`);
  });
}

// For keepAsMine: the budget file's backups hold what is now the person's, so
// they go into their folder, each copied and checked before it is removed.
// Their backups and the budget's are named alike, so a name can be taken
// already. A file that is the same is not copied again; a different one is
// never replaced, and the backup goes in under the name with "-household"
// before the .json (then -2, -3...). So a move stopped half way finishes when
// it is run again. One that can't be moved stays where it was and the rest
// still go; the call then says some were left.
export async function moveHouseholdBackupsTo(pid) {
  return inOrder(pid, async () => {
    if (!isTauri) return;
    const { fs, base } = await fsApi();
    if (!(await fs.exists(BACKUP_DIR, { baseDir: base }))) return;
    const names = (await fs.readDir(BACKUP_DIR, { baseDir: base }))
      .filter((e) => e.isFile && e.name.endsWith(".json"))
      .map((e) => e.name);
    if (!names.length) return;
    await ensureDir(ownDir(pid));
    let left = 0;
    for (const name of names) {
      try {
        const from = `${BACKUP_DIR}/${name}`;
        const text = await fs.readTextFile(from, { baseDir: base });
        const stem = name.slice(0, -".json".length);
        for (let n = 0; ; n += 1) {
          const to = `${ownDir(pid)}/${n === 0 ? name : `${stem}-household${n > 1 ? `-${n}` : ""}.json`}`;
          if (!(await fs.exists(to, { baseDir: base }))) {
            await writeVerified(to, text);
            break;
          }
          if ((await fs.readTextFile(to, { baseDir: base })) === text) break;
        }
        await fs.remove(from, { baseDir: base });
      } catch (err) {
        left += 1;
        noteStorageFault("move backup", err);
      }
    }
    if (left) throw new Error(`${left} of the budget's backups could not be moved`);
  });
}

// The budget file's save swallows a failed file write and carries on from the
// localStorage mirror. That is fine for an ordinary edit, but moving an entry
// out of the household must know the household file really has it, so the store
// gets a write that reads the file back. (In the browser the save is
// localStorage itself, which throws when it fails.)
async function writeHousehold(text) {
  const saved = await window.storage.set(STORAGE_KEY, text);
  if (isTauri) {
    let held = null;
    try {
      held = await readStoreFile();
    } catch (err) {
      noteStorageFault("read back", err);
    }
    if (!held || held.status !== "ok" || held.text !== text) throw new Error("The budget file does not hold what was just saved");
  }
  return saved;
}

// What budgetStore.js is given to reach the disk. Private due dates are kept
// on this computer by a later task; until then the store's calls do nothing.
export const ownIo = {
  readOwnFile,
  writeOwnFile,
  setAsideOwnFile,
  restoreSetAsideOwnFile,
  listOwnBackups,
  readOwnBackup,
  replaceOwnBackup,
  moveHouseholdBackupsTo,
  listOwnFiles,
  writeHousehold,
  rememberPrivateDue: () => {},
  forgetPrivateDue: () => {},
};
