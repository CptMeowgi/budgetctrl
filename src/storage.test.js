import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// storage.js reaches the app-data folder through @tauri-apps/plugin-fs, which
// only exists inside the app. This stands in for it with a folder in memory, so
// the real path, naming and ordering logic runs here. Like the real plugin it
// will not write into a folder that isn't there, and the app-data folder itself
// does not exist on a clean machine until something creates it.
const disk = vi.hoisted(() => {
  const files = new Map();
  const dirs = new Set();
  const calls = [];
  const state = { rootMade: false, beforeWrite: null, mangle: null, failRead: new Set() };
  const clean = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const hasDir = (p) => (p === "" ? state.rootMade : dirs.has(p));

  // Seeds a file the way a past session left it, folders and all.
  const put = (path, text) => {
    state.rootMade = true;
    for (let dir = parentOf(path); dir; dir = parentOf(dir)) dirs.add(dir);
    files.set(path, text);
  };

  const api = {
    BaseDirectory: { AppData: "AppData" },
    async exists(path) {
      path = clean(path);
      return files.has(path) || dirs.has(path);
    },
    async readTextFile(path) {
      path = clean(path);
      calls.push(["read", path]);
      if (state.failRead.has(path)) throw new Error(`os error 5: ${path} is locked`);
      if (!files.has(path)) throw new Error(`os error 2: ${path} not found`);
      return files.get(path);
    },
    async writeTextFile(path, text) {
      path = clean(path);
      calls.push(["write", path]);
      if (state.beforeWrite) await state.beforeWrite(path, text);
      if (!hasDir(parentOf(path))) throw new Error(`os error 3: no folder for ${path}`);
      files.set(path, state.mangle ? state.mangle(path, text) : text);
    },
    async mkdir(path, options = {}) {
      path = clean(path);
      calls.push(["mkdir", path]);
      if (!options.recursive) {
        if (dirs.has(path)) throw new Error("os error 183: already exists");
        if (!hasDir(parentOf(path))) throw new Error("os error 3: no parent");
      }
      state.rootMade = true;
      for (let dir = path; dir; dir = parentOf(dir)) dirs.add(dir);
    },
    async readDir(path) {
      path = clean(path);
      calls.push(["readDir", path]);
      if (!hasDir(path)) throw new Error(`os error 3: ${path} not found`);
      const own = (child) => child.slice(path ? path.length + 1 : 0);
      const entries = [];
      for (const f of files.keys()) if (parentOf(f) === path) entries.push({ name: own(f), isFile: true, isDirectory: false, isSymlink: false });
      for (const d of dirs) if (parentOf(d) === path) entries.push({ name: own(d), isFile: false, isDirectory: true, isSymlink: false });
      return entries;
    },
    async remove(path) {
      path = clean(path);
      calls.push(["remove", path]);
      if (!files.delete(path) && !dirs.delete(path)) throw new Error(`os error 2: ${path} not found`);
    },
  };

  const reset = () => {
    files.clear();
    dirs.clear();
    calls.length = 0;
    state.rootMade = false;
    state.beforeWrite = null;
    state.mangle = null;
    state.failRead.clear();
  };
  return { files, dirs, calls, state, api, put, reset, parentOf };
});

vi.mock("@tauri-apps/plugin-fs", () => disk.api);

const HOUSEHOLD_KEY = "budget-app-data";
const OWN_A_KEY = "budget-app-data:own-a";

// Anna's own budget, with something in it that must never show up elsewhere.
const PLAIN = JSON.stringify({ v: 1, budget: { months: {}, note: "CANARY-7Q" } });
const doc = (n) => JSON.stringify({ v: 1, budget: { n } });
const GOOD_BACKUP = "budget-ctrl-2026-10-20-0900-daily.json";

// The files directly inside a folder of the fake disk ("" is the app-data folder).
const filesIn = (dir) => [...disk.files.keys()].filter((f) => disk.parentOf(f) === dir).map((f) => f.slice(dir ? dir.length + 1 : 0)).sort();

// vitest runs these in Node, which has no localStorage here.
function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

let storage;
let ls;

// A fresh copy of storage.js, which installs window.storage when it loads and
// reads whether it is inside the app when platform.js loads.
async function load(inApp) {
  vi.resetModules();
  ls = memoryStorage();
  vi.stubGlobal("localStorage", ls);
  vi.stubGlobal("window", inApp ? { __TAURI_INTERNALS__: {} } : {});
  return await import("./storage.js");
}

beforeEach(() => {
  disk.reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 14, 32));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("which person ids may name a file", () => {
  beforeEach(async () => { storage = await load(true); });

  it("accepts lowercase letters and digits, up to 40", () => {
    for (const id of ["a", "t", "k3x9m2z", "a".repeat(40)]) expect(storage.validPersonId(id)).toBe(true);
  });

  it("refuses anything that could name another file or a clash on Windows", () => {
    for (const id of ["", "A", "Anna", "../x", "a/b", "a\\b", "a.b", "a b", "a-b", "own-a", "a".repeat(41), null, undefined, 7, {}]) {
      expect(storage.validPersonId(id)).toBe(false);
    }
  });

  it("names the file own-<id>.json, and throws for an id it won't use", () => {
    expect(storage.ownFileName("a")).toBe("own-a.json");
    expect(storage.ownFileName("k3x9m2z")).toBe("own-k3x9m2z.json");
    expect(() => storage.ownFileName("../x")).toThrow();
    expect(() => storage.ownFileName("A")).toThrow();
    expect(() => storage.ownFileName(undefined)).toThrow();
  });

  const asks = [
    ["readOwnFile", (id) => storage.readOwnFile(id)],
    ["writeOwnFile", (id) => storage.writeOwnFile(id, PLAIN)],
    ["setAsideOwnFile", (id) => storage.setAsideOwnFile(id)],
    ["restoreSetAsideOwnFile", (id) => storage.restoreSetAsideOwnFile(id)],
    ["listOwnBackups", (id) => storage.listOwnBackups(id)],
    ["readOwnBackup", (id) => storage.readOwnBackup(id, GOOD_BACKUP)],
    ["replaceOwnBackup", (id) => storage.replaceOwnBackup(id, GOOD_BACKUP, PLAIN)],
    ["moveHouseholdBackupsTo", (id) => storage.moveHouseholdBackupsTo(id)],
  ];
  it.each(asks)("%s refuses a bad id and touches nothing", async (_name, ask) => {
    for (const id of ["../x", "A", "a/b", "", undefined, "a".repeat(41)]) {
      await expect(ask(id)).rejects.toThrow();
    }
    expect(disk.calls).toEqual([]);
    expect(ls.map.size).toBe(0);
  });

  it("refuses a backup name that isn't a plain file name", async () => {
    for (const name of ["../../budget-ctrl.json", "x/y.json", "..\\x.json", "budget-ctrl-2026-10-20-0900-daily.json.new", "notes.txt", "", undefined]) {
      await expect(storage.readOwnBackup("a", name)).rejects.toThrow();
      await expect(storage.replaceOwnBackup("a", name, PLAIN)).rejects.toThrow();
    }
    expect(disk.calls).toEqual([]);
  });
});

describe("an own budget file in the app", () => {
  beforeEach(async () => { storage = await load(true); });

  it("reads back what was written, beside the budget file, and mirrors it", async () => {
    await storage.writeOwnFile("a", PLAIN);
    expect(disk.files.get("own-a.json")).toBe(PLAIN);
    expect(ls.getItem(OWN_A_KEY)).toBe(PLAIN);
    expect(await storage.readOwnFile("a")).toEqual({ status: "ok", text: PLAIN });
  });

  it("creates the app-data folder on a clean machine", async () => {
    expect(disk.state.rootMade).toBe(false);
    await storage.writeOwnFile("a", PLAIN);
    expect(disk.files.get("own-a.json")).toBe(PLAIN);
  });

  it("keeps each person's file apart", async () => {
    await storage.writeOwnFile("a", doc(1));
    await storage.writeOwnFile("t", doc(2));
    expect((await storage.readOwnFile("a")).text).toBe(doc(1));
    expect((await storage.readOwnFile("t")).text).toBe(doc(2));
  });

  it("says missing when there is no file and no mirror, and creates nothing", async () => {
    expect(await storage.readOwnFile("a")).toEqual({ status: "missing" });
    expect(disk.files.size).toBe(0);
  });

  it("reads a truncated file as unreadable, never missing, and keeps a copy of it beside it", async () => {
    const cut = PLAIN.slice(0, 25);
    disk.put("own-a.json", cut);
    const read = await storage.readOwnFile("a");
    expect(read.status).toBe("unreadable");
    expect(read.text).toBe(cut);
    expect(read.keptAs).toBe("own-a-unreadable-20261027-1432.json");
    expect(disk.files.get("own-a-unreadable-20261027-1432.json")).toBe(cut);
    // The damaged file itself is left for the person to deal with.
    expect(disk.files.get("own-a.json")).toBe(cut);
  });

  it("reads an empty file, and one that isn't a JSON object, as unreadable", async () => {
    for (const bad of ["", "   \n", "[1,2]", "null", "42", "not json"]) {
      disk.reset();
      disk.put("own-a.json", bad);
      expect((await storage.readOwnFile("a")).status).toBe("unreadable");
    }
  });

  it("reads a file it can't open as unreadable, not missing, so nothing starts a fresh one over it", async () => {
    disk.put("own-a.json", PLAIN);
    disk.state.failRead.add("own-a.json");
    expect(await storage.readOwnFile("a")).toEqual({ status: "unreadable", text: "", keptAs: null });
    expect(storage.getStorageFault()).toContain("read");
    expect(disk.files.get("own-a.json")).toBe(PLAIN);
  });

  it("adopts the mirror and writes it back when the file is missing", async () => {
    ls.setItem(OWN_A_KEY, PLAIN);
    expect(await storage.readOwnFile("a")).toEqual({ status: "ok", text: PLAIN });
    expect(disk.files.get("own-a.json")).toBe(PLAIN);
  });

  it("adopts the mirror when the file is unreadable, and keeps the damaged file's copy", async () => {
    const cut = PLAIN.slice(0, 25);
    disk.put("own-a.json", cut);
    ls.setItem(OWN_A_KEY, PLAIN);
    expect(await storage.readOwnFile("a")).toEqual({ status: "ok", text: PLAIN });
    expect(disk.files.get("own-a.json")).toBe(PLAIN);
    expect(disk.files.get("own-a-unreadable-20261027-1432.json")).toBe(cut);
  });

  it("does not adopt a mirror that isn't a JSON object, or another person's mirror", async () => {
    ls.setItem(OWN_A_KEY, "{\"v\":1,");
    expect(await storage.readOwnFile("a")).toEqual({ status: "missing" });
    ls.setItem(OWN_A_KEY, "[1]");
    expect(await storage.readOwnFile("a")).toEqual({ status: "missing" });
    ls.removeItem(OWN_A_KEY);
    ls.setItem("budget-app-data:own-t", PLAIN);
    ls.setItem(HOUSEHOLD_KEY, PLAIN);
    expect(await storage.readOwnFile("a")).toEqual({ status: "missing" });
    expect(disk.files.size).toBe(0);
  });

  it("leaves a sealed file's contents alone: it is only a JSON object to this layer", async () => {
    const sealed = JSON.stringify({ v: 1, sealed: { iv: "AAAA", data: "BBBB" }, password: {}, recovery: {} });
    await storage.writeOwnFile("a", sealed);
    expect(await storage.readOwnFile("a")).toEqual({ status: "ok", text: sealed });
  });

  it("saves one at a time, in the order asked, even when an earlier one is slow", async () => {
    let first = true;
    disk.state.beforeWrite = async (path) => {
      if (path === "own-a.json" && first) {
        first = false;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    };
    const slow = storage.writeOwnFile("a", doc(1));
    const fast = storage.writeOwnFile("a", doc(2));
    await Promise.all([slow, fast]);
    expect(disk.files.get("own-a.json")).toBe(doc(2));
  });

  it("lets a read wait for the save before it", async () => {
    const saving = storage.writeOwnFile("a", doc(5));
    const read = await storage.readOwnFile("a");
    await saving;
    expect(read).toEqual({ status: "ok", text: doc(5) });
  });

  describe("when the write doesn't work", () => {
    it("rejects when the file read back is not what was written, and keeps the mirror", async () => {
      disk.state.mangle = (path, text) => (path === "own-a.json" ? text.slice(0, 10) : text);
      await expect(storage.writeOwnFile("a", PLAIN)).rejects.toThrow();
      expect(storage.getStorageFault()).toContain("write");
      expect(ls.getItem(OWN_A_KEY)).toBe(PLAIN);
    });

    it("rejects when the folder can't be written to, and keeps the mirror", async () => {
      disk.state.beforeWrite = () => { throw new Error("os error 5: access denied"); };
      await expect(storage.writeOwnFile("a", PLAIN)).rejects.toThrow("access denied");
      expect(ls.getItem(OWN_A_KEY)).toBe(PLAIN);
    });

    it("carries on with the next save after a failed one", async () => {
      disk.state.beforeWrite = () => { throw new Error("os error 5: access denied"); };
      await expect(storage.writeOwnFile("a", doc(1))).rejects.toThrow();
      disk.state.beforeWrite = null;
      await storage.writeOwnFile("a", doc(2));
      expect(disk.files.get("own-a.json")).toBe(doc(2));
    });
  });
});

describe("the daily backup of an own file", () => {
  beforeEach(async () => { storage = await load(true); });

  const day = (d, h = 9) => vi.setSystemTime(new Date(2026, 9, d, h, 0));

  it("is taken before the day's first write, so it holds the file as it was", async () => {
    await storage.writeOwnFile("a", doc(1));
    expect(filesIn("backups/own-a")).toEqual([]);

    day(28);
    await storage.writeOwnFile("a", doc(2));
    expect(filesIn("backups/own-a")).toEqual(["budget-ctrl-2026-10-28-0900-daily.json"]);
    expect(disk.files.get("backups/own-a/budget-ctrl-2026-10-28-0900-daily.json")).toBe(doc(1));
    expect(disk.files.get("own-a.json")).toBe(doc(2));
  });

  it("is taken once a day", async () => {
    await storage.writeOwnFile("a", doc(1));
    day(28);
    await storage.writeOwnFile("a", doc(2));
    day(28, 18);
    await storage.writeOwnFile("a", doc(3));
    expect(filesIn("backups/own-a")).toEqual(["budget-ctrl-2026-10-28-0900-daily.json"]);
    day(29);
    await storage.writeOwnFile("a", doc(4));
    expect(filesIn("backups/own-a")).toEqual(["budget-ctrl-2026-10-28-0900-daily.json", "budget-ctrl-2026-10-29-0900-daily.json"]);
  });

  it("is kept per person: Tom's first write of the day is backed up although Anna's already was", async () => {
    await storage.writeOwnFile("a", doc(1));
    await storage.writeOwnFile("t", doc(10));
    day(28);
    await storage.writeOwnFile("a", doc(2));
    await storage.writeOwnFile("t", doc(11));
    expect(disk.files.get("backups/own-a/budget-ctrl-2026-10-28-0900-daily.json")).toBe(doc(1));
    expect(disk.files.get("backups/own-t/budget-ctrl-2026-10-28-0900-daily.json")).toBe(doc(10));
  });

  it("does not depend on the budget file's own daily backup, nor the other way round", async () => {
    // The budget file is written first today, which marks its day as done.
    await window.storage.set(HOUSEHOLD_KEY, doc("h1"));
    disk.put("own-a.json", doc(1));
    await storage.writeOwnFile("a", doc(2));
    expect(disk.files.get("backups/own-a/budget-ctrl-2026-10-27-1432-daily.json")).toBe(doc(1));

    // Anna's day is done now, and the budget file's backup still comes on its own.
    day(28);
    await storage.writeOwnFile("a", doc(3));
    await window.storage.set(HOUSEHOLD_KEY, doc("h2"));
    expect(filesIn("backups")).toContain("budget-ctrl-2026-10-28-0900-daily.json");
    expect(disk.files.get("backups/budget-ctrl-2026-10-28-0900-daily.json")).toBe(doc("h1"));
  });

  it("is never made from a file that can't be opened", async () => {
    disk.put("own-a.json", PLAIN.slice(0, 25));
    await storage.writeOwnFile("a", doc(1));
    expect(filesIn("backups/own-a")).toEqual([]);
  });

  it("never stops a save when it can't be made", async () => {
    disk.put("own-a.json", doc(1));
    disk.state.beforeWrite = (path) => { if (path.startsWith("backups/")) throw new Error("os error 112: disk full"); };
    await storage.writeOwnFile("a", doc(2));
    expect(disk.files.get("own-a.json")).toBe(doc(2));
  });

  it("keeps 14 in each person's folder and touches no other folder", async () => {
    // The budget file has 20 of its own and Tom has 16, all left as they are.
    for (let i = 1; i <= 20; i++) disk.put(`backups/budget-ctrl-2026-09-${String(i).padStart(2, "0")}-0900-daily.json`, doc(`h${i}`));
    for (let i = 1; i <= 16; i++) disk.put(`backups/own-t/budget-ctrl-2026-09-${String(i).padStart(2, "0")}-0900-daily.json`, doc(`t${i}`));

    await storage.writeOwnFile("a", doc(0));
    for (let d = 1; d <= 20; d++) {
      day(d);
      await storage.writeOwnFile("a", doc(d));
    }

    const expected = [];
    for (let d = 7; d <= 20; d++) expected.push(`budget-ctrl-2026-10-${String(d).padStart(2, "0")}-0900-daily.json`);
    expect(filesIn("backups/own-a")).toEqual(expected);
    expect(filesIn("backups").filter((f) => f.endsWith(".json"))).toHaveLength(20);
    expect(filesIn("backups/own-t")).toHaveLength(16);
  });

  it("is not counted among the budget file's backups, and its pruning leaves it alone", async () => {
    for (let i = 1; i <= 20; i++) disk.put(`backups/budget-ctrl-2026-09-${String(i).padStart(2, "0")}-0900-daily.json`, doc(`h${i}`));
    for (let i = 1; i <= 3; i++) disk.put(`backups/own-a/budget-ctrl-2026-09-${String(i).padStart(2, "0")}-0900-daily.json`, doc(`a${i}`));

    expect(await storage.listBackups()).toHaveLength(20);
    await storage.writeBackup(doc("h"), "before-import");
    expect(await storage.listBackups()).toHaveLength(14);
    expect(filesIn("backups/own-a")).toHaveLength(3);
  });
});

describe("setting an own file aside, and bringing it back", () => {
  beforeEach(async () => { storage = await load(true); });

  it("copies the file to own-<id>-removed-<time>.json, then removes the file and its mirror", async () => {
    await storage.writeOwnFile("a", PLAIN);
    const name = await storage.setAsideOwnFile("a");
    expect(name).toBe("own-a-removed-20261027-1432.json");
    expect(disk.files.get("own-a-removed-20261027-1432.json")).toBe(PLAIN);
    expect(disk.files.has("own-a.json")).toBe(false);
    expect(ls.getItem(OWN_A_KEY)).toBeNull();
    // With the mirror gone too, nothing brings the removed budget back by itself.
    expect(await storage.readOwnFile("a")).toEqual({ status: "missing" });
  });

  it("writes the copy before it removes the file", async () => {
    await storage.writeOwnFile("a", PLAIN);
    disk.calls.length = 0;
    await storage.setAsideOwnFile("a");
    const order = disk.calls.filter(([op]) => op === "write" || op === "remove").map(([op, path]) => `${op} ${path}`);
    expect(order).toEqual(["write own-a-removed-20261027-1432.json", "remove own-a.json"]);
  });

  it("keeps the file when the copy didn't come out right", async () => {
    await storage.writeOwnFile("a", PLAIN);
    disk.state.mangle = (path, text) => (path.includes("-removed-") ? "" : text);
    await expect(storage.setAsideOwnFile("a")).rejects.toThrow();
    expect(disk.files.get("own-a.json")).toBe(PLAIN);
  });

  it("sets aside a damaged file as it is", async () => {
    const cut = PLAIN.slice(0, 25);
    disk.put("own-a.json", cut);
    await storage.setAsideOwnFile("a");
    expect(disk.files.get("own-a-removed-20261027-1432.json")).toBe(cut);
    expect(disk.files.has("own-a.json")).toBe(false);
  });

  it("does nothing, and says so, when there is no file", async () => {
    expect(await storage.setAsideOwnFile("a")).toBeNull();
    expect(disk.files.size).toBe(0);
  });

  it("round-trips: restore puts the file back and removes the set-aside copy", async () => {
    await storage.writeOwnFile("a", PLAIN);
    await storage.setAsideOwnFile("a");
    expect(await storage.restoreSetAsideOwnFile("a")).toBe(true);
    expect(disk.files.get("own-a.json")).toBe(PLAIN);
    expect(filesIn("").filter((f) => f.includes("-removed-"))).toEqual([]);
    expect(await storage.readOwnFile("a")).toEqual({ status: "ok", text: PLAIN });
    expect(ls.getItem(OWN_A_KEY)).toBe(PLAIN);
  });

  it("restores the newest set-aside file and leaves the older one", async () => {
    disk.put("own-a-removed-20261001-0900.json", doc("old"));
    disk.put("own-a-removed-20261026-1015.json", doc("new"));
    expect(await storage.restoreSetAsideOwnFile("a")).toBe(true);
    expect(disk.files.get("own-a.json")).toBe(doc("new"));
    expect(filesIn("")).toContain("own-a-removed-20261001-0900.json");
    expect(filesIn("")).not.toContain("own-a-removed-20261026-1015.json");
  });

  it("is false when nothing was set aside for this person", async () => {
    disk.put("own-t-removed-20261026-1015.json", doc("tom"));
    disk.put("own-ab-removed-20261026-1015.json", doc("ab"));
    disk.put("own-a-unreadable-20261026-1015.json", doc("damaged"));
    expect(await storage.restoreSetAsideOwnFile("a")).toBe(false);
    expect(disk.files.has("own-a.json")).toBe(false);
    expect(filesIn("")).toHaveLength(3);
  });

  it("never replaces a file that is there", async () => {
    disk.put("own-a.json", doc("live"));
    disk.put("own-a-removed-20261026-1015.json", doc("old"));
    expect(await storage.restoreSetAsideOwnFile("a")).toBe(false);
    expect(disk.files.get("own-a.json")).toBe(doc("live"));
    expect(filesIn("")).toContain("own-a-removed-20261026-1015.json");
  });
});

describe("which own files are there", () => {
  beforeEach(async () => { storage = await load(true); });

  it("lists the person ids with an own-<id>.json, and nothing else", async () => {
    disk.put("budget-ctrl.json", "{}");
    disk.put("lock.json", "{}");
    disk.put("own-t.json", "{}");
    disk.put("own-a.json", "{}");
    disk.put("own-k3x9.json", "{}");
    disk.put("own-A.json", "{}");
    disk.put("own-a-removed-20261026-1015.json", "{}");
    disk.put("own-a-unreadable-20261026-1015.json", "{}");
    disk.put("own-a-LAPTOP.json", "{}");
    disk.put("own-a (1).json", "{}");
    disk.put("own-.json", "{}");
    disk.put("own-a.json.new", "{}");
    disk.put(`own-${"a".repeat(41)}.json`, "{}");
    disk.put("backups/own-b.json", "{}");
    disk.put("backups/own-c/budget-ctrl-2026-10-20-0900-daily.json", "{}");
    expect(await storage.listOwnFiles()).toEqual(["a", "k3x9", "t"]);
  });

  it("does not take a folder for a file", async () => {
    disk.put("own-a.json", "{}");
    disk.put("own-t.json/inside.txt", "x");
    expect(await storage.listOwnFiles()).toEqual(["a"]);
  });

  it("is empty on a clean machine, where there is no folder yet", async () => {
    expect(await storage.listOwnFiles()).toEqual([]);
  });
});

describe("the backups of an own file", () => {
  beforeEach(async () => { storage = await load(true); });

  const dir = "backups/own-a";
  const one = (d, tag = "daily") => `budget-ctrl-2026-10-${String(d).padStart(2, "0")}-0900-${tag}.json`;

  it("lists the newest first, only this person's, only .json", async () => {
    disk.put(`${dir}/${one(20)}`, "x");
    disk.put(`${dir}/${one(22)}`, "x");
    disk.put(`${dir}/${one(21, "before-restore")}`, "x");
    disk.put(`${dir}/notes.txt`, "x");
    disk.put(`backups/own-t/${one(23)}`, "x");
    disk.put(`backups/${one(24)}`, "x");
    expect(await storage.listOwnBackups("a")).toEqual([one(22), one(21, "before-restore"), one(20)]);
    expect(await storage.listOwnBackups("t")).toEqual([one(23)]);
    expect(await storage.listOwnBackups("b")).toEqual([]);
  });

  it("shows a backup that only has its .new file under its own name, once", async () => {
    disk.put(`${dir}/${one(20)}`, "x");
    disk.put(`${dir}/${one(21)}.new`, "y");
    disk.put(`${dir}/${one(22)}`, "x");
    disk.put(`${dir}/${one(22)}.new`, "y");
    expect(await storage.listOwnBackups("a")).toEqual([one(22), one(21), one(20)]);
  });

  it("reads a backup, and falls back to the .new file when that is all a crash left", async () => {
    disk.put(`${dir}/${one(20)}`, doc("kept"));
    disk.put(`${dir}/${one(21)}.new`, doc("new"));
    expect(await storage.readOwnBackup("a", one(20))).toBe(doc("kept"));
    expect(await storage.readOwnBackup("a", one(21))).toBe(doc("new"));
    await expect(storage.readOwnBackup("a", one(23))).rejects.toThrow();
  });

  it("reads the whole one when a crash left both, whichever is cut short", async () => {
    disk.put(`${dir}/${one(20)}`, doc("old"));
    disk.put(`${dir}/${one(20)}.new`, doc("new").slice(0, 8));
    expect(await storage.readOwnBackup("a", one(20))).toBe(doc("old"));
    disk.put(`${dir}/${one(21)}`, doc("new").slice(0, 8));
    disk.put(`${dir}/${one(21)}.new`, doc("new"));
    expect(await storage.readOwnBackup("a", one(21))).toBe(doc("new"));
  });

  it("replaces a backup and leaves exactly one file holding the new text", async () => {
    disk.put(`${dir}/${one(20)}`, doc("old"));
    disk.put(`${dir}/${one(21)}`, doc("untouched"));
    await storage.replaceOwnBackup("a", one(20), doc("sealed"));
    expect(filesIn(dir)).toEqual([one(20), one(21)]);
    expect(disk.files.get(`${dir}/${one(20)}`)).toBe(doc("sealed"));
    expect(disk.files.get(`${dir}/${one(21)}`)).toBe(doc("untouched"));
  });

  it("goes by write .new, remove, write, remove .new, since there is no rename", async () => {
    disk.put(`${dir}/${one(20)}`, doc("old"));
    disk.calls.length = 0;
    await storage.replaceOwnBackup("a", one(20), doc("sealed"));
    const steps = disk.calls.filter(([op]) => op === "write" || op === "remove").map(([op, path]) => `${op} ${path.slice(dir.length + 1)}`);
    expect(steps).toEqual([`write ${one(20)}.new`, `remove ${one(20)}`, `write ${one(20)}`, `remove ${one(20)}.new`]);
  });

  it("loses nothing if the app stops half way: the new text is still there under the backup's name", async () => {
    disk.put(`${dir}/${one(20)}`, doc("old"));
    let writes = 0;
    disk.state.beforeWrite = () => { if (++writes === 2) throw new Error("the power went"); };
    await expect(storage.replaceOwnBackup("a", one(20), doc("sealed"))).rejects.toThrow();
    expect(filesIn(dir)).toEqual([`${one(20)}.new`]);
    disk.state.beforeWrite = null;
    expect(await storage.listOwnBackups("a")).toEqual([one(20)]);
    expect(await storage.readOwnBackup("a", one(20))).toBe(doc("sealed"));
  });

  it("prunes a backup that only has a .new file along with the rest", async () => {
    for (let d = 10; d <= 24; d++) disk.put(`${dir}/${one(d)}`, "x");
    disk.put(`${dir}/${one(9)}.new`, "y");
    disk.put("own-a.json", doc(1));
    vi.setSystemTime(new Date(2026, 9, 28, 9, 0));
    await storage.writeOwnFile("a", doc(2));
    const left = await storage.listOwnBackups("a");
    expect(left).toHaveLength(14);
    expect(left[0]).toBe("budget-ctrl-2026-10-28-0900-daily.json");
    expect(filesIn(dir).some((f) => f.endsWith(".new"))).toBe(false);
  });
});

describe("moving the budget file's backups into an own folder", () => {
  beforeEach(async () => { storage = await load(true); });

  const one = (d, tag = "daily") => `budget-ctrl-2026-10-${String(d).padStart(2, "0")}-0900-${tag}.json`;

  it("copies every backup into backups/own-<id>/ and removes it from backups/", async () => {
    disk.put(`backups/${one(20)}`, doc("h20"));
    disk.put(`backups/${one(21)}`, doc("h21"));
    disk.put(`backups/${one(22, "before-import")}`, doc("h22"));
    disk.put(`backups/own-t/${one(23)}`, doc("tom"));
    disk.put("budget-ctrl.json", doc("now"));
    disk.put("own-a.json", doc("mine"));

    await storage.moveHouseholdBackupsTo("a");

    expect(filesIn("backups")).toEqual([]);
    expect(filesIn("backups/own-a")).toEqual([one(20), one(21), one(22, "before-import")]);
    expect(disk.files.get(`backups/own-a/${one(22, "before-import")}`)).toBe(doc("h22"));
    expect(disk.files.get(`backups/own-a/${one(20)}`)).toBe(doc("h20"));
    // Another person's backups, the budget file and Anna's own file stay where they are.
    expect(filesIn("backups/own-t")).toEqual([one(23)]);
    expect(disk.files.get("budget-ctrl.json")).toBe(doc("now"));
    expect(disk.files.get("own-a.json")).toBe(doc("mine"));
    expect(await storage.listBackups()).toEqual([]);
  });

  it("copies before it removes", async () => {
    disk.put(`backups/${one(20)}`, doc("h20"));
    disk.calls.length = 0;
    await storage.moveHouseholdBackupsTo("a");
    const steps = disk.calls.filter(([op]) => op === "write" || op === "remove").map(([op, path]) => `${op} ${path}`);
    expect(steps).toEqual([`write backups/own-a/${one(20)}`, `remove backups/${one(20)}`]);
  });

  it("does nothing when the budget file has no backups", async () => {
    await storage.moveHouseholdBackupsTo("a");
    disk.put("budget-ctrl.json", doc("now"));
    await storage.moveHouseholdBackupsTo("a");
    expect(disk.files.size).toBe(1);
  });

  it("never replaces a backup already in the folder: that one stays where it is, and the rest still move", async () => {
    disk.put(`backups/${one(20)}`, doc("h20"));
    disk.put(`backups/${one(21)}`, doc("h21"));
    disk.put(`backups/own-a/${one(20)}`, doc("anna's own"));
    await expect(storage.moveHouseholdBackupsTo("a")).rejects.toThrow();
    expect(disk.files.get(`backups/own-a/${one(20)}`)).toBe(doc("anna's own"));
    expect(disk.files.get(`backups/${one(20)}`)).toBe(doc("h20"));
    expect(filesIn("backups").filter((f) => f.endsWith(".json"))).toEqual([one(20)]);
    expect(disk.files.get(`backups/own-a/${one(21)}`)).toBe(doc("h21"));
  });

  it("keeps a backup in the budget's folder when its copy didn't come out right", async () => {
    disk.put(`backups/${one(20)}`, doc("h20"));
    disk.state.mangle = (path, text) => (path.startsWith("backups/own-a/") ? "" : text);
    await expect(storage.moveHouseholdBackupsTo("a")).rejects.toThrow();
    expect(disk.files.get(`backups/${one(20)}`)).toBe(doc("h20"));
  });
});

describe("ownIo, the store's way to the disk", () => {
  beforeEach(async () => { storage = await load(true); });

  it("has the own-file functions and the household writer, under their own names", () => {
    expect(Object.keys(storage.ownIo).sort()).toEqual([
      "forgetPrivateDue", "listOwnBackups", "listOwnFiles", "moveHouseholdBackupsTo", "readOwnBackup", "readOwnFile",
      "rememberPrivateDue", "replaceOwnBackup", "restoreSetAsideOwnFile", "setAsideOwnFile", "writeHousehold", "writeOwnFile",
    ]);
    for (const name of Object.keys(storage.ownIo)) expect(typeof storage.ownIo[name]).toBe("function");
    expect(storage.ownIo.writeOwnFile).toBe(storage.writeOwnFile);
    expect(storage.ownIo.readOwnFile).toBe(storage.readOwnFile);
  });

  it("writes the household as the budget file, through the same path as every other save", async () => {
    await storage.ownIo.writeHousehold(doc("h"));
    expect(disk.files.get("budget-ctrl.json")).toBe(doc("h"));
    expect(ls.getItem(HOUSEHOLD_KEY)).toBe(doc("h"));
    expect(disk.files.has("own-a.json")).toBe(false);
  });

  it("has the private-due-date hooks, which do nothing yet", async () => {
    expect(await storage.ownIo.rememberPrivateDue("a", { remind: true, dates: ["2026-11-01"] })).toBeUndefined();
    expect(await storage.ownIo.forgetPrivateDue("a")).toBeUndefined();
    expect(disk.files.size).toBe(0);
    expect(ls.map.size).toBe(0);
  });
});

describe("the budget file, as before", () => {
  beforeEach(async () => { storage = await load(true); });

  it("saves to budget-ctrl.json with the localStorage mirror, and reads it back", async () => {
    await window.storage.set(HOUSEHOLD_KEY, doc("h"));
    expect(disk.files.get("budget-ctrl.json")).toBe(doc("h"));
    expect(ls.getItem(HOUSEHOLD_KEY)).toBe(doc("h"));
    expect(await window.storage.get(HOUSEHOLD_KEY)).toEqual({ value: doc("h") });
  });

  it("still refuses to start a fresh budget over one it can't read", async () => {
    disk.put("budget-ctrl.json", "{\"months\":");
    await expect(window.storage.get(HOUSEHOLD_KEY)).rejects.toMatchObject({ keptAs: "budget-ctrl-2026-10-27-1432-unreadable.json" });
    expect(disk.files.get("budget-ctrl.json")).toBe("{\"months\":");
  });

  it("is not touched by anything done to an own file", async () => {
    await window.storage.set(HOUSEHOLD_KEY, doc("h"));
    await storage.writeOwnFile("a", PLAIN);
    await storage.setAsideOwnFile("a");
    await storage.restoreSetAsideOwnFile("a");
    expect(disk.files.get("budget-ctrl.json")).toBe(doc("h"));
    expect(await storage.listBackups()).toEqual([]);
  });
});

describe("an own file in the browser", () => {
  beforeEach(async () => { storage = await load(false); });

  it("lives in localStorage, with no file touched", async () => {
    await storage.writeOwnFile("a", PLAIN);
    expect(ls.getItem(OWN_A_KEY)).toBe(PLAIN);
    expect(await storage.readOwnFile("a")).toEqual({ status: "ok", text: PLAIN });
    expect(disk.calls).toEqual([]);
  });

  it("says missing when there is nothing", async () => {
    expect(await storage.readOwnFile("a")).toEqual({ status: "missing" });
  });

  it("reads damaged text as unreadable and keeps a copy of it", async () => {
    ls.setItem(OWN_A_KEY, "{\"v\":1,");
    const read = await storage.readOwnFile("a");
    expect(read).toEqual({ status: "unreadable", text: "{\"v\":1,", keptAs: "own-a-unreadable-20261027-1432.json" });
    expect(ls.getItem("budget-app-data:own-a-unreadable-20261027-1432")).toBe("{\"v\":1,");
    expect(ls.getItem(OWN_A_KEY)).toBe("{\"v\":1,");
  });

  it("refuses a bad id and touches nothing", async () => {
    await expect(storage.writeOwnFile("../x", PLAIN)).rejects.toThrow();
    await expect(storage.readOwnFile("A")).rejects.toThrow();
    expect(ls.map.size).toBe(0);
  });

  it("lists the person ids from its keys", async () => {
    ls.setItem(HOUSEHOLD_KEY, "{}");
    ls.setItem("budget-app-data:own-t", "{}");
    ls.setItem("budget-app-data:own-a", "{}");
    ls.setItem("budget-app-data:own-A", "{}");
    ls.setItem("budget-app-data:own-a-removed-20261026-1015", "{}");
    ls.setItem("budget-ctrl-last-backup", "2026-10-27");
    ls.setItem("other", "{}");
    expect(await storage.listOwnFiles()).toEqual(["a", "t"]);
  });

  it("sets a file aside and restores it", async () => {
    await storage.writeOwnFile("a", PLAIN);
    expect(await storage.setAsideOwnFile("a")).toBe("own-a-removed-20261027-1432.json");
    expect(ls.getItem(OWN_A_KEY)).toBeNull();
    expect(ls.getItem("budget-app-data:own-a-removed-20261027-1432")).toBe(PLAIN);
    expect(await storage.listOwnFiles()).toEqual([]);
    expect(await storage.restoreSetAsideOwnFile("a")).toBe(true);
    expect(await storage.readOwnFile("a")).toEqual({ status: "ok", text: PLAIN });
    expect(ls.getItem("budget-app-data:own-a-removed-20261027-1432")).toBeNull();
  });

  it("has no backups to list, read, replace or move", async () => {
    await storage.writeOwnFile("a", PLAIN);
    expect(await storage.listOwnBackups("a")).toEqual([]);
    await expect(storage.readOwnBackup("a", GOOD_BACKUP)).rejects.toThrow();
    await storage.replaceOwnBackup("a", GOOD_BACKUP, PLAIN);
    await storage.moveHouseholdBackupsTo("a");
    expect([...ls.map.keys()]).toEqual([OWN_A_KEY]);
    expect(disk.calls).toEqual([]);
  });
});
