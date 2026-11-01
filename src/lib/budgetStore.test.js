import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createStore, HOUSEHOLD, newOwnBudget, OwnUnreadableError } from "./budgetStore.js";
import { hydrate, migrate } from "../model.js";
import { addPerson } from "./people.js";
import { calendarFor } from "./calendar.js";
import { isBudgetText } from "./backups.js";
import { makeRecoveryCode, newBudgetKey, normalizePassword, normalizeRecoveryCode, openSealed, sealBudget, unwrapKey, wrapKey } from "./vault.js";

// Real counts are slow on purpose; tests use a cheap one.
const FAST = 1000;
const TODAY = new Date(2026, 9, 15, 12);
const BUDGET_FILE = "budget-ctrl.json";
const FORTNIGHTLY = JSON.parse(readFileSync("src/fixtures/budget-0.7-fortnightly.json", "utf8"));

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(TODAY); });
afterAll(() => vi.useRealTimers());

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A disk in memory that keeps the promises the real io makes (storage.js):
// writes that reject, a listing that rejects, a damaged file kept as a copy
// or not (a locked file), and the daily backup a write takes of the file as
// it was before the day's first change. The log says what was asked of it.
function memoryDisk() {
  const files = new Map();
  const folders = new Map(); // "" is the budget file's backups, a person id is theirs
  const log = [];
  const delays = []; // ms for each write in turn, so an early write can be the slow one
  const failing = new Set(); // io methods that reject from now on
  const locked = new Set(); // people whose damaged file can't be copied
  const backedUpToday = new Set();
  let n = 0;
  const next = () => String(++n).padStart(4, "0");
  const folder = (who) => {
    if (!folders.has(who)) folders.set(who, new Map());
    return folders.get(who);
  };
  const ownFile = (pid) => {
    if (!/^[a-z0-9]{1,40}$/.test(pid)) throw new Error(`No file is named after ${pid}`);
    return `own-${pid}.json`;
  };
  const mustWork = (op) => { if (failing.has(op)) throw new Error(`${op} failed`); };
  const mustBeBudget = (text) => { if (!isBudgetText(text)) throw new Error("That is not a budget to save"); };
  const slow = () => pause(delays.length ? delays.shift() : 0);
  const daily = (who, file) => {
    if (backedUpToday.has(who)) return;
    backedUpToday.add(who);
    if (isBudgetText(files.get(file))) folder(who).set(`budget-ctrl-2026-10-15-${next()}-daily.json`, files.get(file));
  };
  // One copy per distinct damage, as storage.js keeps it; none for a locked file.
  const keep = (pid, text) => {
    if (locked.has(pid)) return null;
    const kept = [...files].find(([f, t]) => f.startsWith(`own-${pid}-unreadable-`) && t === text);
    if (kept) return kept[0];
    const name = `own-${pid}-unreadable-20261015-${next()}.json`;
    files.set(name, text);
    return name;
  };

  const io = {
    async listOwnFiles() {
      log.push(["listOwnFiles"]);
      mustWork("listOwnFiles");
      return [...files.keys()].map((f) => /^own-([a-z0-9]{1,40})\.json$/.exec(f)?.[1]).filter(Boolean).sort();
    },
    async readOwnFile(pid) {
      const file = ownFile(pid);
      log.push(["readOwnFile", pid]);
      if (!files.has(file)) return { status: "missing" };
      const text = files.get(file);
      if (isBudgetText(text)) return { status: "ok", text };
      if (locked.has(pid)) return { status: "unreadable", text: "", keptAs: null };
      return { status: "unreadable", text, keptAs: keep(pid, text) };
    },
    async keepOwnUnreadable(pid, text) {
      ownFile(pid);
      log.push(["keepOwnUnreadable", pid]);
      return keep(pid, text);
    },
    async writeOwnFile(pid, text) {
      const file = ownFile(pid);
      mustBeBudget(text);
      await slow();
      mustWork("writeOwnFile");
      daily(pid, file);
      files.set(file, text);
      log.push(["writeOwnFile", pid]);
    },
    async writeHousehold(text) {
      await slow();
      mustWork("writeHousehold");
      daily("", BUDGET_FILE);
      files.set(BUDGET_FILE, text);
      log.push(["writeHousehold"]);
    },
    async setAsideOwnFile(pid) {
      const file = ownFile(pid);
      log.push(["setAsideOwnFile", pid]);
      mustWork("setAsideOwnFile");
      if (!files.has(file)) return null;
      const name = `own-${pid}-removed-20261015-${next()}.json`;
      files.set(name, files.get(file));
      files.delete(file);
      return name;
    },
    async restoreSetAsideOwnFile(pid) {
      const file = ownFile(pid);
      log.push(["restoreSetAsideOwnFile", pid]);
      mustWork("restoreSetAsideOwnFile");
      if (files.has(file)) return false;
      const newest = [...files.keys()].filter((f) => f.startsWith(`own-${pid}-removed-`)).sort().pop();
      if (!newest) return false;
      files.set(file, files.get(newest));
      files.delete(newest);
      return true;
    },
    async listOwnBackups(pid) {
      ownFile(pid);
      return [...folder(pid).keys()].sort().reverse();
    },
    async readOwnBackup(pid, name) {
      ownFile(pid);
      if (!folder(pid).has(name)) throw new Error("There is no such backup");
      return folder(pid).get(name);
    },
    async replaceOwnBackup(pid, name, text) {
      ownFile(pid);
      mustBeBudget(text);
      mustWork("replaceOwnBackup");
      mustWork(`replaceOwnBackup:${name}`);
      folder(pid).set(name, text);
      log.push(["replaceOwnBackup", pid, name]);
    },
    async ensureDailyBackup() {
      log.push(["ensureDailyBackup"]);
      daily("", BUDGET_FILE);
    },
    async moveHouseholdBackupsTo(pid) {
      ownFile(pid);
      log.push(["moveHouseholdBackupsTo", pid]);
      mustWork("moveHouseholdBackupsTo");
      for (const [name, text] of folder("")) {
        folder(pid).set(folder(pid).has(name) ? name.replace(/\.json$/, "-household.json") : name, text);
        folder("").delete(name);
      }
    },
    rememberPrivateDue() {},
    forgetPrivateDue(pid) { log.push(["forgetPrivateDue", pid]); },
  };

  return {
    io, files, folder, log, delays, failing, locked,
    household: () => JSON.parse(files.get(BUDGET_FILE)),
    ownText: (pid) => files.get(`own-${pid}.json`),
    ownBudget: (pid) => JSON.parse(files.get(`own-${pid}.json`)).budget,
    writes: () => log.filter(([op]) => !/^(read|list)/.test(op)),
  };
}

const anna = { id: "a", name: "Anna", color: "#6366f1" };
const tom = { id: "t", name: "Tom", color: "#10b981" };
const UNCAT = { name: "Uncategorized", color: "#9ca3af", icon: "·" };
const period = (fields = {}) => ({ income: 0, expenses: [], recurring: [], upcoming: [], credits: [], ...fields });

function household(people = [anna, tom]) {
  return {
    months: {
      "2026-09": period({ income: 6000, expenses: [{ id: "e0", name: "Deposit", amount: 900, date: "2026-09-02", category: "Home", paidBy: "t" }] }),
      "2026-10": period({ income: 6200, expenses: [{ id: "e1", name: "Lidl", amount: 84.2, date: "2026-10-03", category: "Groceries", paidBy: "a", paidWith: "visa" }] }),
    },
    currency: "PLN",
    locale: "pl-PL",
    cutoffDay: 1,
    setupDone: true,
    language: "pl",
    updates: { auto: false },
    categories: [UNCAT, { name: "Groceries", color: "#10b981", icon: "🍔", cap: 1200 }, { name: "Home", color: "#0066cc", icon: "🏠", group: "Bills" }],
    creditCategories: [{ name: "Salary", color: "#10b981", icon: "💰" }, { name: "Other", color: "#9ca3af", icon: "·" }],
    accounts: [{ id: "visa", name: "Visa", owner: "a" }],
    people,
  };
}

function annasMine() {
  return {
    months: { "2026-10": period({ expenses: [{ id: "m1", name: "CANARY-7Q", amount: 19.99, date: "2026-10-05", category: "Fun" }] }) },
    currency: "PLN",
    locale: "pl-PL",
    cutoffDay: 1,
    setupDone: true,
    categories: [UNCAT, { name: "Fun", color: "#8b5cf6", icon: "🎮" }],
  };
}

const plainOwn = (budget) => JSON.stringify({ v: 1, budget });
const withExpense = (doc, key, entry) => ({ ...doc, months: { ...doc.months, [key]: { ...doc.months[key], expenses: [...doc.months[key].expenses, entry] } } });
const withoutExpense = (doc, key, id) => ({ ...doc, months: { ...doc.months, [key]: { ...doc.months[key], expenses: doc.months[key].expenses.filter((e) => e.id !== id) } } });
const personIn = (doc, id) => (doc.people || []).find((p) => p.id === id);

// The budget file is on disk, as it is when the app starts.
async function open(raw, disk) {
  if (!disk.files.has(BUDGET_FILE)) disk.files.set(BUDGET_FILE, JSON.stringify(raw));
  return createStore(structuredClone(raw), { io: disk.io, iterations: FAST, recoveryIterations: FAST });
}

// Anna has a plain own budget with the canary in it, and her profile is open.
async function annaWithMine() {
  const disk = memoryDisk();
  disk.files.set("own-a.json", plainOwn(annasMine()));
  const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
  expect(await store.openProfile("a")).toBe(true);
  const mine = await store.openMine();
  return { disk, store, mine };
}

// As above, then sealed with "correct horse". Her backups include a plain
// one from before, and one of the budget file moved in by "Keep it as mine".
async function sealedAnna() {
  const disk = memoryDisk();
  disk.files.set("own-a.json", plainOwn(annasMine()));
  disk.folder("a").set("budget-ctrl-2026-10-01-0900-daily.json", plainOwn(annasMine()));
  disk.folder("a").set("budget-ctrl-2026-09-30-0900-daily-household.json", JSON.stringify(withExpense(household([anna]), "2026-10", { id: "x1", name: "CANARY-7Q", amount: 5, date: "2026-10-01", category: "Groceries", paidBy: "a" })));
  const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
  await store.openProfile("a");
  await store.openMine();
  const code = makeRecoveryCode();
  await store.setPassword("correct horse", code);
  return { disk, store, code };
}

const caught = (promise) => promise.then(() => null, (err) => err);

describe("a budget from before profiles", () => {
  it("opens a 0.8 budget unchanged, writes it back with no new keys, and never touches an own file", async () => {
    const disk = memoryDisk();
    const store = await open(FORTNIGHTLY, disk);
    const expected = hydrate(migrate(structuredClone(FORTNIGHTLY)));
    expect(JSON.parse(store.householdText())).toEqual(expected);
    for (const key of ['"own"', "budgetOf", "hasOwn"]) expect(store.householdText()).not.toContain(key);
    expect(store.profilesOn()).toBe(false);
    expect(store.listFault).toBeNull();

    expect(await store.save(store.household())).toBe(store.household());
    expect(disk.household()).toEqual(expected);
    // Asked only which own files exist (none), and then to save the budget file.
    expect(disk.log).toEqual([["listOwnFiles"], ["writeHousehold"]]);
  });

  it("hands the household out stamped, and writes it without the stamp or an own budget", async () => {
    const disk = memoryDisk();
    const store = await open({ ...household(), own: { a: annasMine() } }, disk);
    expect(store.household().budgetOf).toBe(HOUSEHOLD);
    expect(store.household().own).toBeUndefined();
    expect(store.doc(HOUSEHOLD)).toBe(store.household());
    expect(store.householdText()).not.toContain("CANARY-7Q");
  });
});

describe("profilesOn", () => {
  const on = async (people) => (await open(household(people), memoryDisk())).profilesOn();

  it("is off for one person and on for two", async () => {
    expect(await on([anna])).toBe(false);
    expect(await on([anna, tom])).toBe(true);
  });

  it("does not count someone removed", async () => {
    expect(await on([anna, { ...tom, removed: true }])).toBe(false);
  });

  it("is on for one person with a budget of their own", async () => {
    expect(await on([{ ...anna, hasOwn: true }])).toBe(true);
  });

  it("lists the current people and reads the marker", async () => {
    const store = await open(household([{ ...anna, hasOwn: true }, tom, { id: "z", name: "Zed", color: "#f59e0b", removed: true }]), memoryDisk());
    expect(store.people().map((p) => p.id)).toEqual(["a", "t"]);
    expect(store.hasOwn("a")).toBe(true);
    expect(store.hasOwn("t")).toBe(false);
  });
});

describe("newOwnBudget", () => {
  it("starts empty, with the household's money settings and categories but no caps and no people", () => {
    const hh = hydrate(migrate(structuredClone(FORTNIGHTLY)));
    const mine = newOwnBudget(hh);
    expect(mine.currency).toBe(hh.currency);
    expect(mine.locale).toBe(hh.locale);
    expect(mine.cutoffDay).toBe(hh.cutoffDay);
    expect(mine.paySchedule).toEqual(hh.paySchedule);
    expect(mine.paySchedule).not.toBe(hh.paySchedule);
    expect(mine.creditCategories).toEqual(hh.creditCategories);
    expect(mine.categories).toEqual(hh.categories.map((c) => {
      const { cap: _cap, ...rest } = c;
      return rest;
    }));
    expect(mine.categories.some((c) => "cap" in c)).toBe(false);
    expect(mine.setupDone).toBe(true);
    expect(mine.people).toBeUndefined();
    // One period, the running one under the household's own pay schedule.
    expect(Object.keys(mine.months)).toEqual([calendarFor(hh).current()]);
    expect(Object.values(mine.months)).toEqual([period()]);
    expect(mine.recurringTemplate).toEqual([]);
    expect(mine.creditTemplate).toEqual([]);
    expect(mine.accounts).toEqual([]);
  });
});

describe("a new Mine", () => {
  it("starts empty from the household's settings, and is written only on its first save", async () => {
    const disk = memoryDisk();
    const store = await open(household(), disk);
    expect(await store.ownStatus("t")).toBe("none");
    expect(await store.openProfile("t")).toBe(true);
    expect(store.session()).toBe("t");
    const mine = await store.openMine();
    expect(mine.budgetOf).toBe("t");
    expect(store.own()).toBe(mine);
    expect(store.doc("t")).toBe(mine);
    expect(store.mineOpen()).toBe(true);
    for (const m of Object.values(mine.months)) expect(m).toEqual(period());
    expect(mine.currency).toBe("PLN");
    expect(mine.locale).toBe("pl-PL");
    expect(mine.categories.map((c) => c.name)).toEqual(["Uncategorized", "Groceries", "Home"]);
    expect(mine.categories.some((c) => "cap" in c)).toBe(false);
    expect(mine.setupDone).toBe(true);
    expect(mine.people).toBeUndefined();
    expect(disk.writes()).toEqual([]);

    const key = Object.keys(mine.months)[0];
    const saved = await store.save(withExpense(mine, key, { id: "t1", name: "Gym", amount: 120, date: "2026-10-10", category: "Uncategorized" }));
    expect(saved.budgetOf).toBe("t");
    expect(disk.ownBudget("t").months[key].expenses.map((e) => e.name)).toEqual(["Gym"]);
    expect(disk.ownText("t")).not.toContain("budgetOf");
    expect(personIn(JSON.parse(store.householdText()), "t").hasOwn).toBe(true);
    expect(personIn(disk.household(), "t").hasOwn).toBe(true);
    expect(disk.files.get(BUDGET_FILE)).not.toContain("Gym");

    // The marker is written the first time only.
    await store.save({ ...saved, n: 2 });
    expect(disk.writes().map(([op]) => op)).toEqual(["writeOwnFile", "writeHousehold", "writeOwnFile"]);
  });
});

describe("a damaged or missing own file", () => {
  it("never starts an empty Mine over a damaged file", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", '{"v":1,"budget":{"mon');
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    // The profile still opens, for the household.
    expect(await store.openProfile("a")).toBe(true);
    const err = await caught(store.openMine());
    expect(err).toBeInstanceOf(OwnUnreadableError);
    expect(err.personId).toBe("a");
    expect(err.reason).toBe("damaged");
    expect(err.keptAs).toMatch(/^own-a-unreadable-/);
    expect(store.own()).toBeNull();
    expect((await caught(store.ownStatus("a")))?.reason).toBe("damaged");
    expect(disk.writes()).toEqual([]);
    expect(disk.ownText("a")).toBe('{"v":1,"budget":{"mon');
  });

  it("never starts an empty Mine when the household says a file exists and it isn't there", async () => {
    const disk = memoryDisk();
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    expect(store.hasOwn("a")).toBe(true);
    expect(await store.openProfile("a")).toBe(true);
    const err = await caught(store.openMine());
    expect(err).toBeInstanceOf(OwnUnreadableError);
    expect(err.reason).toBe("missing");
    expect(store.own()).toBeNull();
    expect(disk.writes()).toEqual([]);
    expect(disk.files.has("own-a.json")).toBe(false);
  });

  it("reads a file that is a JSON object but not an own budget as damaged", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", JSON.stringify({ v: 2, something: "newer" }));
    const store = await open(household([anna, tom]), disk);
    expect((await caught(store.ownStatus("a")))?.reason).toBe("damaged");
  });
});

describe("an own file the household doesn't mark", () => {
  it("is marked when the store opens, and Mine opens that file rather than a new one", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", plainOwn(annasMine()));
    const store = await open(household([anna, tom]), disk);
    expect(store.hasOwn("a")).toBe(true);
    expect(personIn(JSON.parse(store.householdText()), "a").hasOwn).toBe(true);
    await store.openProfile("a");
    expect(JSON.stringify(await store.openMine())).toContain("CANARY-7Q");
    expect(disk.writes()).toEqual([]);
    expect(JSON.stringify(disk.ownBudget("a"))).toContain("CANARY-7Q");
  });

  it("puts back a person missing from the household", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", plainOwn(annasMine()));
    const store = await open(household([tom]), disk);
    expect(personIn(store.household(), "a")).toMatchObject({ id: "a", hasOwn: true });
    expect(store.people().map((p) => p.id)).toEqual(["t", "a"]);
    // A colour nobody uses.
    expect(personIn(store.household(), "a").color).not.toBe(tom.color);
  });

  it("brings back a person marked removed, as they were", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", plainOwn(annasMine()));
    const store = await open(household([{ ...anna, removed: true }, tom]), disk);
    expect(personIn(store.household(), "a")).toEqual({ ...anna, hasOwn: true });
  });

  it("ignores set-aside and damaged copies", async () => {
    const disk = memoryDisk();
    disk.files.set("own-t-removed-20261001-0900.json", plainOwn(annasMine()));
    disk.files.set("own-t-unreadable-20261001-0900.json", "{");
    const store = await open(household([anna, { ...tom, removed: true }]), disk);
    expect(personIn(store.household(), "t").removed).toBe(true);
    expect(store.hasOwn("t")).toBe(false);
  });
});

describe("when the own files can't be listed", () => {
  it("still opens, going by the household's markers, and says so", async () => {
    const disk = memoryDisk();
    disk.failing.add("listOwnFiles");
    disk.files.set("own-a.json", plainOwn(annasMine()));
    disk.files.set("own-t.json", plainOwn(annasMine()));
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    expect(store.listFault).toBeInstanceOf(Error);
    expect(store.hasOwn("a")).toBe(true);
    expect(store.hasOwn("t")).toBe(false);
    // Tom's file is not marked, but it is read whatever the marker says.
    expect(await store.ownStatus("t")).toBe("plain");
    await store.openProfile("t");
    expect(JSON.stringify(await store.openMine())).toContain("CANARY-7Q");
    expect(disk.writes()).toEqual([]);
  });
});

describe("routing by the stamp", () => {
  it("saves each doc to the budget its stamp names, and nowhere else", async () => {
    const { disk, store, mine } = await annaWithMine();
    const household = store.household();

    const saved = await store.save({ ...mine, note: "mine" });
    expect(saved.note).toBe("mine");
    expect(disk.ownBudget("a").note).toBe("mine");
    expect(disk.household().note).toBeUndefined();

    await store.save({ ...household, note: "ours" });
    expect(disk.household().note).toBe("ours");
    expect(disk.ownBudget("a").note).toBe("mine");
    expect(disk.files.get(BUDGET_FILE)).not.toContain("CANARY-7Q");
  });

  it("refuses a doc stamped for a budget that isn't open, and writes nothing", async () => {
    const { disk, store, mine } = await annaWithMine();
    const before = disk.writes().length;
    expect(await store.save({ ...mine, budgetOf: "t" })).toBe(false);
    expect(await store.save({ ...mine, budgetOf: "zz" })).toBe(false);
    expect(disk.writes().length).toBe(before);
    expect(disk.files.has("own-t.json")).toBe(false);
  });

  it("throws for a doc with no stamp", async () => {
    const { store, mine } = await annaWithMine();
    const { budgetOf: _stamp, ...bare } = mine;
    await expect(store.save(bare)).rejects.toThrow();
    await expect(store.save(null)).rejects.toThrow();
    await expect(store.saveBoth(bare, store.household())).rejects.toThrow();
  });

  it("refuses another person's doc once the profile has switched", async () => {
    const { disk, store, mine } = await annaWithMine();
    disk.delays.push(30);
    const saving = store.save({ ...mine, n: 1 });
    // Opening Tom's profile waits for Anna's save, then closes her session.
    expect(await store.openProfile("t")).toBe(true);
    expect(await saving).toBeTruthy();
    expect(disk.ownBudget("a").n).toBe(1);
    expect(store.session()).toBe("t");
    expect(store.mineOpen()).toBe(false);
    expect(store.own()).toBeNull();
    expect(store.doc("a")).toBeNull();
    expect(await store.save({ ...mine, n: 2 })).toBe(false);
    expect(disk.ownBudget("a").n).toBe(1);
    expect(disk.files.has("own-t.json")).toBe(false);
  });

  it("never opens a profile for a person whose id could pass for the household", async () => {
    const disk = memoryDisk();
    const store = await open(household([anna, { id: HOUSEHOLD, name: "Mallory", color: "#ec4899" }]), disk);
    await expect(store.openProfile(HOUSEHOLD)).rejects.toThrow();
    await expect(store.openProfile("../x")).rejects.toThrow();
    expect(store.session()).toBeNull();
  });

  it("refuses to open someone who isn't a current person", async () => {
    const store = await open(household([anna, { ...tom, removed: true }]), memoryDisk());
    await expect(store.openProfile("t")).rejects.toThrow();
    await expect(store.openProfile("q")).rejects.toThrow();
  });
});

describe("saving while Mine locks or the profile closes", () => {
  it("lands a save queued before Mine locks, and refuses one made after", async () => {
    const { disk, store, mine } = await annaWithMine();
    disk.delays.push(30);
    const saving = store.save({ ...mine, n: 1 });
    await store.lockMine();
    expect(await saving).toBeTruthy();
    expect(disk.ownBudget("a").n).toBe(1);
    expect(store.mineOpen()).toBe(false);
    expect(store.own()).toBeNull();
    expect(store.session()).toBe("a");

    const before = disk.writes().length;
    expect(await store.save({ ...mine, n: 2 })).toBe(false);
    expect(disk.writes().length).toBe(before);
    expect(disk.ownBudget("a").n).toBe(1);
  });

  it("lands a sealed save queued before Mine locks, sealed", async () => {
    const { disk, store } = await sealedAnna();
    const mine = store.own();
    disk.delays.push(30);
    const saving = store.save({ ...mine, n: 1 });
    await store.lockMine();
    expect(await saving).toBeTruthy();
    expect(disk.ownText("a")).not.toContain("CANARY-7Q");
    expect(await store.save({ ...mine, n: 2 })).toBe(false);
    expect(await store.unlockMine("correct horse")).toBe(true);
    expect(store.own().n).toBe(1);
  });

  it("lands a save queued before the profile closes, and refuses one made after", async () => {
    const { disk, store, mine } = await annaWithMine();
    disk.delays.push(30);
    const saving = store.save({ ...mine, n: 1 });
    await store.closeProfile();
    expect(await saving).toBeTruthy();
    expect(disk.ownBudget("a").n).toBe(1);
    expect(store.session()).toBeNull();
    expect(store.mineOpen()).toBe(false);

    const before = disk.writes().length;
    expect(await store.save({ ...mine, n: 2 })).toBe(false);
    expect(disk.writes().length).toBe(before);
    // The household still saves with no profile open.
    await store.save({ ...store.household(), note: "ours" });
    expect(disk.household().note).toBe("ours");
  });

  it("asks for an open profile before it opens Mine", async () => {
    const store = await open(household(), memoryDisk());
    await expect(store.openMine()).rejects.toThrow();
  });
});

describe("saves in order", () => {
  it("lands two saves in the order they were made, even when the first is slow", async () => {
    const { disk, store, mine } = await annaWithMine();
    disk.delays.push(30, 0);
    const first = store.save({ ...mine, n: 1 });
    const second = store.save({ ...mine, n: 2 });
    await Promise.all([first, second]);
    await store.closeProfile();
    await store.openProfile("a");
    expect((await store.openMine()).n).toBe(2);
  });
});

describe("saveBoth", () => {
  it("never loses an entry moved into Mine when the household's write fails", async () => {
    const { disk, store, mine } = await annaWithMine();
    const hh = store.household();
    const lidl = hh.months["2026-10"].expenses[0];
    const to = withExpense(mine, "2026-10", { ...lidl, id: "moved", paidBy: undefined, paidWith: undefined });
    const from = withoutExpense(hh, "2026-10", lidl.id);
    disk.failing.add("writeHousehold");
    await expect(store.saveBoth(to, from)).rejects.toThrow();
    // The target has it, and the source still has it.
    expect(disk.ownBudget("a").months["2026-10"].expenses.map((e) => e.name)).toContain("Lidl");
    expect(disk.household().months["2026-10"].expenses.map((e) => e.name)).toContain("Lidl");
  });

  it("never loses an entry moved into the household when Mine's write fails", async () => {
    const { disk, store, mine } = await annaWithMine();
    const hh = store.household();
    const canary = mine.months["2026-10"].expenses[0];
    const to = withExpense(hh, "2026-10", { ...canary, id: "moved", paidBy: "a" });
    const from = withoutExpense(mine, "2026-10", canary.id);
    disk.failing.add("writeOwnFile");
    await expect(store.saveBoth(to, from)).rejects.toThrow();
    expect(disk.household().months["2026-10"].expenses.map((e) => e.name)).toContain("CANARY-7Q");
    expect(disk.ownBudget("a").months["2026-10"].expenses.map((e) => e.name)).toContain("CANARY-7Q");
  });

  it("writes both, target first", async () => {
    const { disk, store, mine } = await annaWithMine();
    const hh = store.household();
    const lidl = hh.months["2026-10"].expenses[0];
    const to = withExpense(mine, "2026-10", { ...lidl, id: "moved" });
    const from = withoutExpense(hh, "2026-10", lidl.id);
    expect(await store.saveBoth(to, from)).toBe(true);
    expect(disk.writes().map(([op]) => op)).toEqual(["writeOwnFile", "writeHousehold"]);
    expect(disk.ownBudget("a").months["2026-10"].expenses.map((e) => e.id)).toContain("moved");
    expect(disk.household().months["2026-10"].expenses.map((e) => e.id)).not.toContain("e1");
  });

  it("writes nothing when either would be refused", async () => {
    const { disk, store, mine } = await annaWithMine();
    const before = disk.writes().length;
    expect(await store.saveBoth({ ...mine, budgetOf: "t" }, store.household())).toBe(false);
    expect(await store.saveBoth(store.household(), { ...mine, budgetOf: "t" })).toBe(false);
    await store.lockMine();
    expect(await store.saveBoth(store.household(), mine)).toBe(false);
    expect(disk.writes().length).toBe(before);
  });
});

describe("a sealed Mine", () => {
  it("leaves no plain copy of Mine, in its file or any backup", async () => {
    const { disk, store } = await sealedAnna();
    expect(disk.ownText("a")).not.toContain("CANARY-7Q");
    // The two from before, and the one the sealing write took of the plain file.
    expect(disk.folder("a").size).toBe(3);
    for (const [name, text] of disk.folder("a")) {
      expect(text, name).not.toContain("CANARY-7Q");
      expect(JSON.parse(text), name).toMatchObject({ v: 1, sealed: expect.any(Object), password: expect.any(Object), recovery: expect.any(Object) });
    }
    expect(disk.files.get(BUDGET_FILE)).not.toContain("CANARY-7Q");
    expect(await store.ownStatus("a")).toBe("sealed");
    expect(store.plainBackupsLeft()).toBe(0);
    // Nothing about the password or the key is in the household.
    expect(store.householdText()).not.toMatch(/sealed|salt|iterations/);
  });

  it("says how many backups are still plain when one can't be sealed, and seals it at the next save", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", plainOwn(annasMine()));
    disk.folder("a").set("budget-ctrl-2026-10-01-0900-daily.json", plainOwn(annasMine()));
    disk.folder("a").set("budget-ctrl-2026-10-02-0900-daily.json", plainOwn(annasMine()));
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    await store.openProfile("a");
    await store.openMine();
    expect(store.plainBackupsLeft()).toBe(0);
    disk.failing.add("replaceOwnBackup:budget-ctrl-2026-10-01-0900-daily.json");
    // Mine is sealed, so the password is set: the call doesn't fail over a backup.
    await store.setPassword("correct horse", makeRecoveryCode());
    expect(await store.ownStatus("a")).toBe("sealed");
    expect(disk.ownText("a")).not.toContain("CANARY-7Q");
    expect(store.plainBackupsLeft()).toBe(1);
    expect(disk.folder("a").get("budget-ctrl-2026-10-01-0900-daily.json")).toContain("CANARY-7Q");
    expect(disk.folder("a").get("budget-ctrl-2026-10-02-0900-daily.json")).not.toContain("CANARY-7Q");

    // Still failing: the next save says so again.
    await store.save({ ...store.own(), n: 1 });
    expect(store.plainBackupsLeft()).toBe(1);

    disk.failing.delete("replaceOwnBackup:budget-ctrl-2026-10-01-0900-daily.json");
    await store.save({ ...store.own(), n: 2 });
    expect(store.plainBackupsLeft()).toBe(0);
    for (const [name, text] of disk.folder("a")) expect(text, name).not.toContain("CANARY-7Q");
  });

  it("reads a backup it has seen sealed only once", async () => {
    const { disk, store } = await sealedAnna();
    const reads = [];
    const read = disk.io.readOwnBackup;
    disk.io.readOwnBackup = (pid, name) => { reads.push(name); return read(pid, name); };
    await store.save({ ...store.own(), n: 1 });
    await store.save({ ...store.own(), n: 2 });
    expect(reads).toEqual([]);
  });

  it("seals a damaged backup's text as it is, and won't restore it", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", plainOwn(annasMine()));
    disk.folder("a").set("budget-ctrl-2026-10-01-0900-daily.json", '{"v":1,"budget":{"note":"CANARY-7Q", cut sh');
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    await store.openProfile("a");
    await store.openMine();
    await store.setPassword("correct horse", makeRecoveryCode());
    expect(store.plainBackupsLeft()).toBe(0);
    for (const [name, text] of disk.folder("a")) expect(text, name).not.toContain("CANARY-7Q");

    const backup = JSON.parse(disk.folder("a").get("budget-ctrl-2026-10-01-0900-daily.json"));
    const key = await unwrapKey(backup.password, normalizePassword("correct horse"));
    expect(await openSealed(backup.sealed, key)).toEqual({ damagedBackup: '{"v":1,"budget":{"note":"CANARY-7Q", cut sh' });
    const before = disk.ownText("a");
    expect(await store.restoreMine("budget-ctrl-2026-10-01-0900-daily.json", "correct horse")).toBeNull();
    expect(disk.ownText("a")).toBe(before);
  });

  it("opens with the right password only, and Mine with it", async () => {
    const { store } = await sealedAnna();
    await store.closeProfile();
    expect(await store.openProfile("a", "wrong horse")).toBe(false);
    expect(await store.openProfile("a")).toBe(false);
    expect(store.session()).toBeNull();
    expect(await store.openProfile("a", "correct horse")).toBe(true);
    expect(store.mineOpen()).toBe(true);
    expect(JSON.stringify(store.own())).toContain("CANARY-7Q");
    expect(store.own().budgetOf).toBe("a");
    expect(store.mustSetPassword()).toBe(false);
  });

  it("opens with the recovery code typed loosely", async () => {
    const { store, code } = await sealedAnna();
    await store.closeProfile();
    expect(await store.openWithRecovery("a", "not-the-code")).toBe(false);
    expect(await store.openWithRecovery("a", code.toLowerCase())).toBe(true);
    expect(store.mustSetPassword()).toBe(true);
    expect(JSON.stringify(await store.openMine())).toContain("CANARY-7Q");
  });

  it("rejects openMine while locked, and unlocks with the password", async () => {
    const { store } = await sealedAnna();
    await store.lockMine();
    expect(store.session()).toBe("a");
    await expect(store.openMine()).rejects.toThrow();
    expect(await store.unlockMine("wrong horse")).toBe(false);
    expect(store.mineOpen()).toBe(false);
    expect(await store.unlockMine("correct horse")).toBe(true);
    expect(JSON.stringify(await store.openMine())).toContain("CANARY-7Q");
  });

  it("keeps saving sealed", async () => {
    const { disk, store } = await sealedAnna();
    await store.save({ ...store.own(), note: "CANARY-7Q again" });
    expect(disk.ownText("a")).not.toContain("CANARY-7Q");
    await store.lockMine();
    await store.unlockMine("correct horse");
    expect(store.own().note).toBe("CANARY-7Q again");
  });

  it("asks for a password only once, and only one long enough", async () => {
    const { store } = await sealedAnna();
    await expect(store.setPassword("another one", makeRecoveryCode())).rejects.toThrow();
    const plain = await annaWithMine();
    await expect(plain.store.setPassword("short", makeRecoveryCode())).rejects.toThrow();
    expect(await plain.store.ownStatus("a")).toBe("plain");
  });

  it("seals a new Mine on its first write, and marks it in the household", async () => {
    const disk = memoryDisk();
    const store = await open(household(), disk);
    await store.openProfile("t");
    await store.openMine();
    await store.setPassword("correct horse", makeRecoveryCode());
    expect(await store.ownStatus("t")).toBe("sealed");
    expect(store.hasOwn("t")).toBe(true);
    expect(personIn(disk.household(), "t").hasOwn).toBe(true);
  });
});

describe("changing the password", () => {
  it("keeps the key, so the old password fails and an older backup still opens with it", async () => {
    const { disk, store } = await sealedAnna();
    expect(await store.changePassword("wrong horse", "battery staple")).toBe(false);
    expect(await store.changePassword("correct horse", "battery staple")).toBe(true);
    await store.lockMine();
    expect(await store.unlockMine("correct horse")).toBe(false);
    expect(await store.unlockMine("battery staple")).toBe(true);

    const [name] = await disk.io.listOwnBackups("a");
    const backup = JSON.parse(disk.folder("a").get(name));
    const oldKey = await unwrapKey(backup.password, normalizePassword("correct horse"));
    expect(JSON.stringify(await openSealed(backup.sealed, oldKey))).toContain("CANARY-7Q");
    // Restored, it is sealed with the current password, not the backup's.
    expect(JSON.stringify(await store.restoreMine(name, "correct horse"))).toContain("CANARY-7Q");
    await store.lockMine();
    expect(await store.unlockMine("correct horse")).toBe(false);
    expect(await store.unlockMine("battery staple")).toBe(true);
  });

  it("makes a new key when asked, so a key from an old backup opens nothing", async () => {
    const { disk, store } = await sealedAnna();
    const [name] = await disk.io.listOwnBackups("a");
    const backup = JSON.parse(disk.folder("a").get(name));
    await expect(store.changePassword("correct horse", "battery staple", { newKey: true })).rejects.toThrow();
    const code = makeRecoveryCode();
    expect(await store.changePassword("correct horse", "battery staple", { newKey: true, code })).toBe(true);

    const now = JSON.parse(disk.ownText("a"));
    const oldKey = await unwrapKey(backup.password, normalizePassword("correct horse"));
    await expect(openSealed(now.sealed, oldKey)).rejects.toThrow();
    // The old wrapper copied into the file doesn't open it either: the old
    // password unwraps the old key, which doesn't open the data.
    disk.files.set("own-a.json", JSON.stringify({ ...now, password: backup.password }));
    await store.closeProfile();
    const err = await caught(store.openProfile("a", "correct horse"));
    expect(err).toBeInstanceOf(OwnUnreadableError);
    expect(err.reason).toBe("damaged");
    expect(store.mineOpen()).toBe(false);
    await store.closeProfile();

    disk.files.set("own-a.json", JSON.stringify(now));
    expect(await store.openProfile("a", "battery staple")).toBe(true);
    expect(JSON.stringify(store.own())).toContain("CANARY-7Q");
    await store.closeProfile();
    expect(await store.openWithRecovery("a", code)).toBe(true);
  });

  it("removePassword makes the file plain", async () => {
    const { disk, store } = await sealedAnna();
    expect(await store.removePassword("wrong horse")).toBe(false);
    expect(await store.ownStatus("a")).toBe("sealed");
    expect(await store.removePassword("correct horse")).toBe(true);
    expect(await store.ownStatus("a")).toBe("plain");
    expect(JSON.stringify(disk.ownBudget("a"))).toContain("CANARY-7Q");
    await store.save({ ...store.own(), n: 1 });
    expect(disk.ownBudget("a").n).toBe(1);
    await store.closeProfile();
    expect(await store.openProfile("a")).toBe(true);
    expect(JSON.stringify(await store.openMine())).toContain("CANARY-7Q");
  });

  it("newRecoveryCode replaces the code", async () => {
    const { store, code } = await sealedAnna();
    const next = makeRecoveryCode();
    expect(await store.newRecoveryCode("wrong horse", next)).toBe(false);
    expect(await store.newRecoveryCode("correct horse", next)).toBe(true);
    await store.closeProfile();
    expect(await store.openWithRecovery("a", code)).toBe(false);
    expect(await store.openWithRecovery("a", next)).toBe(true);
  });

  it("setNewPassword works only after the recovery code opened Mine", async () => {
    const { store, code } = await sealedAnna();
    expect(await store.setNewPassword("battery staple", makeRecoveryCode())).toBe(false);
    await store.closeProfile();
    await store.openWithRecovery("a", code);
    const next = makeRecoveryCode();
    expect(await store.setNewPassword("battery staple", next)).toBe(true);
    expect(store.mustSetPassword()).toBe(false);
    await store.closeProfile();
    expect(await store.openProfile("a", "correct horse")).toBe(false);
    expect(await store.openProfile("a", "battery staple")).toBe(true);
    await store.closeProfile();
    expect(await store.openWithRecovery("a", code)).toBe(false);
    expect(await store.openWithRecovery("a", normalizeRecoveryCode(next))).toBe(true);
  });
});

describe("restoring Mine", () => {
  it("restores a plain backup over a damaged file whose copy is kept", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", "{trunc");
    disk.folder("a").set("budget-ctrl-2026-10-01-0900-daily.json", plainOwn(annasMine()));
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    await store.openProfile("a");
    expect(await caught(store.openMine())).toBeInstanceOf(OwnUnreadableError);
    const doc = await store.restoreMine("budget-ctrl-2026-10-01-0900-daily.json");
    expect(doc.budgetOf).toBe("a");
    expect(JSON.stringify(doc)).toContain("CANARY-7Q");
    expect(store.own()).toBe(doc);
    expect(JSON.stringify(disk.ownBudget("a"))).toContain("CANARY-7Q");
    expect([...disk.files.values()]).toContain("{trunc");
  });

  it("opens a sealed backup with its own password, and writes it sealed as it was", async () => {
    const disk = memoryDisk();
    const key = newBudgetKey();
    disk.folder("a").set("budget-ctrl-2026-10-01-0900-daily.json", JSON.stringify({
      v: 1,
      sealed: await sealBudget(annasMine(), key),
      password: await wrapKey(key, normalizePassword("old horse"), FAST),
      recovery: await wrapKey(key, normalizeRecoveryCode(makeRecoveryCode()), FAST),
    }));
    disk.files.set("own-a.json", "{trunc");
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    await store.openProfile("a");
    expect(await store.restoreMine("budget-ctrl-2026-10-01-0900-daily.json")).toBeNull();
    expect(await store.restoreMine("budget-ctrl-2026-10-01-0900-daily.json", "wrong horse")).toBeNull();
    expect(disk.ownText("a")).toBe("{trunc");
    const doc = await store.restoreMine("budget-ctrl-2026-10-01-0900-daily.json", "old horse");
    expect(JSON.stringify(doc)).toContain("CANARY-7Q");
    expect(disk.ownText("a")).not.toContain("CANARY-7Q");
    expect(await store.ownStatus("a")).toBe("sealed");
    await store.lockMine();
    expect(await store.unlockMine("old horse")).toBe(true);
  });

  it("opens a backup of the budget file moved in by Keep it as mine as an own budget", async () => {
    const { store } = await sealedAnna();
    const doc = await store.restoreMine("budget-ctrl-2026-09-30-0900-daily-household.json");
    expect(doc.people).toBeUndefined();
    expect(JSON.stringify(doc)).toContain("CANARY-7Q");
    expect(JSON.stringify(doc)).not.toMatch(/paidBy|paidWith/);
    expect(await store.ownStatus("a")).toBe("sealed");
  });

  it("won't restore over a file it can't keep a copy of, or over a locked Mine", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", "{trunc");
    disk.locked.add("a");
    disk.folder("a").set("budget-ctrl-2026-10-01-0900-daily.json", plainOwn(annasMine()));
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    await store.openProfile("a");
    await expect(store.restoreMine("budget-ctrl-2026-10-01-0900-daily.json")).rejects.toThrow();
    expect(disk.ownText("a")).toBe("{trunc");

    const sealed = await sealedAnna();
    await sealed.store.lockMine();
    const [name] = await sealed.disk.io.listOwnBackups("a");
    const before = sealed.disk.ownText("a");
    await expect(sealed.store.restoreMine(name, "correct horse")).rejects.toThrow();
    expect(sealed.disk.ownText("a")).toBe(before);
  });
});

describe("a sealed file whose key unwraps but whose data won't open", () => {
  // Anna's sealed file with its data sealed again under another key, as if it
  // changed on disk: "correct horse" still unwraps the key it names.
  async function breakSeal(disk) {
    const broken = JSON.stringify({ ...JSON.parse(disk.ownText("a")), sealed: await sealBudget(annasMine(), newBudgetKey()) });
    disk.files.set("own-a.json", broken);
    return broken;
  }
  async function brokenAnna({ locked = false } = {}) {
    const { disk, store, code } = await sealedAnna();
    await store.closeProfile();
    const broken = await breakSeal(disk);
    if (locked) disk.locked.add("a");
    return { disk, store, code, broken };
  }

  const isDamage = (err, broken, disk) => {
    expect(err).toBeInstanceOf(OwnUnreadableError);
    expect(err.personId).toBe("a");
    expect(err.reason).toBe("damaged");
    expect(err.keptAs).toMatch(/^own-a-unreadable-/);
    expect(disk.files.get(err.keptAs)).toBe(broken);
    expect(disk.ownText("a")).toBe(broken);
  };

  it("is damage on opening the profile, which opens for the household", async () => {
    const { disk, store, broken } = await brokenAnna();
    expect(await store.openProfile("a", "wrong horse")).toBe(false);
    isDamage(await caught(store.openProfile("a", "correct horse")), broken, disk);
    expect(store.session()).toBe("a");
    expect(store.mineOpen()).toBe(false);
    expect(store.own()).toBeNull();
  });

  it("is damage on unlocking Mine", async () => {
    const { disk, store } = await sealedAnna();
    await store.lockMine();
    const broken = await breakSeal(disk);
    expect(await store.unlockMine("wrong horse")).toBe(false);
    isDamage(await caught(store.unlockMine("correct horse")), broken, disk);
    expect(store.session()).toBe("a");
    expect(store.mineOpen()).toBe(false);
  });

  it("is damage on opening with the recovery code", async () => {
    const { disk, store, code, broken } = await brokenAnna();
    expect(await store.openWithRecovery("a", makeRecoveryCode())).toBe(false);
    isDamage(await caught(store.openWithRecovery("a", code)), broken, disk);
    expect(store.session()).toBe("a");
    expect(store.mustSetPassword()).toBe(false);
  });

  it("can be replaced by a backup once its text is kept", async () => {
    const { disk, store } = await brokenAnna();
    await caught(store.openProfile("a", "correct horse"));
    const [name] = await disk.io.listOwnBackups("a");
    const doc = await store.restoreMine(name, "correct horse");
    expect(JSON.stringify(doc)).toContain("CANARY-7Q");
    await store.closeProfile();
    expect(await store.openProfile("a", "correct horse")).toBe(true);
    expect(JSON.stringify(store.own())).toContain("CANARY-7Q");
  });

  it("can be started again once its text is kept", async () => {
    const { store } = await brokenAnna();
    await caught(store.openProfile("a", "correct horse"));
    const fresh = await store.startMineAgain();
    expect(fresh.budgetOf).toBe("a");
    expect(await store.ownStatus("a")).toBe("plain");
  });

  it("is never written over when its text couldn't be kept, nor once it has changed", async () => {
    const { disk, store, broken } = await brokenAnna({ locked: true });
    const err = await caught(store.openProfile("a", "correct horse"));
    expect(err.reason).toBe("damaged");
    expect(err.keptAs).toBeNull();
    const [name] = await disk.io.listOwnBackups("a");
    await expect(store.restoreMine(name, "correct horse")).rejects.toThrow();
    await expect(store.startMineAgain()).rejects.toThrow();
    expect(disk.ownText("a")).toBe(broken);

    const other = await brokenAnna();
    await caught(other.store.openProfile("a", "correct horse"));
    const changed = await breakSeal(other.disk);
    await expect(other.store.startMineAgain()).rejects.toThrow();
    expect(other.disk.ownText("a")).toBe(changed);
  });
});

describe("starting Mine again", () => {
  it("starts it empty over a damaged file whose copy is kept", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", "{trunc");
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    await store.openProfile("a");
    const err = await caught(store.openMine());
    expect(err.keptAs).toBeTruthy();
    const fresh = await store.startMineAgain();
    expect(fresh.budgetOf).toBe("a");
    for (const m of Object.values(fresh.months)) expect(m).toEqual(period());
    expect(store.own()).toBe(fresh);
    expect(await store.ownStatus("a")).toBe("plain");
    expect(disk.files.get(err.keptAs)).toBe("{trunc");
  });

  it("starts it empty when its file is missing", async () => {
    const disk = memoryDisk();
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    await store.openProfile("a");
    expect((await caught(store.openMine())).reason).toBe("missing");
    await store.startMineAgain();
    expect(await store.ownStatus("a")).toBe("plain");
    expect(store.hasOwn("a")).toBe(true);
  });

  it("refuses while a damaged file's text couldn't be kept", async () => {
    const disk = memoryDisk();
    disk.files.set("own-a.json", "{locked");
    disk.locked.add("a");
    const store = await open(household([{ ...anna, hasOwn: true }, tom]), disk);
    await store.openProfile("a");
    const err = await caught(store.openMine());
    expect(err.reason).toBe("damaged");
    expect(err.keptAs).toBeNull();
    await expect(store.startMineAgain()).rejects.toThrow();
    expect(disk.ownText("a")).toBe("{locked");
    expect(disk.writes()).toEqual([]);
    expect(store.own()).toBeNull();
  });

  it("refuses when Mine's file opens after all", async () => {
    const { disk, store } = await annaWithMine();
    await expect(store.startMineAgain()).rejects.toThrow();
    expect(JSON.stringify(disk.ownBudget("a"))).toContain("CANARY-7Q");
  });
});

describe("removing a person", () => {
  // Tom has his own budget and a share into the household, with copies in a
  // past period, the running one and one made ahead of time. Anna has a share too.
  function withShares() {
    const raw = household([anna, { ...tom, hasOwn: true }]);
    const share = (id, paidBy) => ({ id, name: "Share", amount: 500, dayOfMonth: 1, category: "Household contributions", contribution: true, paidBy });
    const copy = (id, templateId, paidBy, date) => ({ ...share(id, paidBy), date, templateId });
    raw.creditTemplate = [share("sht", "t"), share("sha", "a")];
    raw.months["2026-09"].credits = [copy("c9", "sht", "t", "2026-09-01"), copy("a9", "sha", "a", "2026-09-01")];
    raw.months["2026-10"].credits = [copy("c10", "sht", "t", "2026-10-01"), copy("a10", "sha", "a", "2026-10-01")];
    raw.months["2026-11"] = period({ credits: [copy("c11", "sht", "t", "2026-11-01"), copy("a11", "sha", "a", "2026-11-01")] });
    return raw;
  }

  it("sets their file aside, ends their share from the running period on, and closes their session", async () => {
    const disk = memoryDisk();
    disk.files.set("own-t.json", plainOwn({ ...annasMine(), note: "Tom's" }));
    const store = await open(withShares(), disk);
    await store.openProfile("t");
    await store.openMine();
    await store.removePerson("t");

    expect(store.session()).toBeNull();
    expect(store.mineOpen()).toBe(false);
    expect(disk.files.has("own-t.json")).toBe(false);
    expect([...disk.files.keys()].filter((f) => /^own-t-removed-.*\.json$/.test(f))).toHaveLength(1);

    const hh = disk.household();
    expect(personIn(hh, "t")).toEqual({ ...tom, removed: true });
    expect(store.hasOwn("t")).toBe(false);
    expect(hh.creditTemplate.map((t) => t.id)).toEqual(["sha"]);
    const running = calendarFor(hh).current();
    expect(running).toBe("2026-10");
    expect(hh.months["2026-09"].credits.map((c) => c.id)).toEqual(["c9", "a9"]);
    expect(hh.months["2026-10"].credits.map((c) => c.id)).toEqual(["a10"]);
    expect(hh.months["2026-11"].credits.map((c) => c.id)).toEqual(["a11"]);
    expect(disk.log).toContainEqual(["forgetPrivateDue", "t"]);
  });

  it("brings their budget back when they are added again by name", async () => {
    const disk = memoryDisk();
    disk.files.set("own-t.json", plainOwn({ ...annasMine(), note: "Tom's" }));
    const store = await open(withShares(), disk);
    await store.removePerson("t");

    const back = addPerson(store.household(), "Tom", () => "new");
    expect(personIn(back, "t").removed).toBeUndefined();
    const stored = await store.save(back);
    expect(stored).not.toBe(back);
    expect(stored.budgetOf).toBe(HOUSEHOLD);
    expect(personIn(stored, "t").hasOwn).toBe(true);
    expect(store.hasOwn("t")).toBe(true);
    expect(disk.ownBudget("t").note).toBe("Tom's");
    expect(personIn(disk.household(), "t").hasOwn).toBe(true);
    // The share isn't set again.
    expect(disk.household().creditTemplate.map((t) => t.id)).toEqual(["sha"]);
  });

  it("changes nothing when their file can't be set aside", async () => {
    const disk = memoryDisk();
    disk.files.set("own-t.json", plainOwn(annasMine()));
    disk.failing.add("setAsideOwnFile");
    const store = await open(withShares(), disk);
    await expect(store.removePerson("t")).rejects.toThrow();
    expect(personIn(store.household(), "t").removed).toBeUndefined();
    expect(store.hasOwn("t")).toBe(true);
    expect(disk.writes()).toEqual([["setAsideOwnFile", "t"]]);
  });

  it("puts their file back when the household can't be saved", async () => {
    const disk = memoryDisk();
    disk.files.set("own-t.json", plainOwn({ ...annasMine(), note: "Tom's" }));
    const store = await open(withShares(), disk);
    disk.failing.add("writeHousehold");
    await expect(store.removePerson("t")).rejects.toThrow();
    expect(disk.ownBudget("t").note).toBe("Tom's");
    expect(store.hasOwn("t")).toBe(true);
    expect(personIn(store.household(), "t").removed).toBeUndefined();
  });

  it("sets nothing aside for someone with no budget of their own, and brings nothing back", async () => {
    const disk = memoryDisk();
    disk.files.set("own-t-removed-20260101-0900.json", plainOwn(annasMine()));
    const store = await open(household([anna, tom]), disk);
    disk.failing.add("writeHousehold");
    await expect(store.removePerson("t")).rejects.toThrow();
    expect(disk.files.has("own-t.json")).toBe(false);
  });
});

describe("people kept", () => {
  it("keeps a person with an own budget when a household without them is saved", async () => {
    const { disk, store } = await annaWithMine();
    const old = { ...store.household(), people: [tom] };
    const stored = await store.save(old);
    expect(stored).not.toBe(old);
    expect(stored.budgetOf).toBe(HOUSEHOLD);
    expect(personIn(stored, "a")).toEqual({ ...anna, hasOwn: true });
    expect(store.household()).toBe(stored);
    expect(personIn(disk.household(), "a").hasOwn).toBe(true);
  });

  it("puts back the marker, and undoes a plain remove", async () => {
    const { disk, store } = await annaWithMine();
    await store.save({ ...store.household(), people: [anna, tom] });
    expect(personIn(disk.household(), "a").hasOwn).toBe(true);
    await store.save({ ...store.household(), people: [{ ...anna, hasOwn: true, removed: true }, tom] });
    expect(personIn(disk.household(), "a")).toEqual({ ...anna, hasOwn: true });
    // With nobody at all, as after a reset.
    const { people: _people, ...reset } = store.household();
    await store.save(reset);
    expect(disk.household().people).toEqual([{ ...anna, hasOwn: true }]);
  });

  it("drops an own budget from a household doc without adding people to it", async () => {
    const disk = memoryDisk();
    const store = await open(FORTNIGHTLY, disk);
    const doc = { ...store.household(), own: { a: annasMine() } };
    const stored = await store.save(doc);
    expect(stored).not.toBe(doc);
    expect(stored.own).toBeUndefined();
    expect("people" in stored).toBe(false);
    expect(disk.household()).toEqual(hydrate(migrate(structuredClone(FORTNIGHTLY))));
  });

  it("returns the same doc when it keeps everyone already", async () => {
    const { store } = await annaWithMine();
    const doc = { ...store.household(), note: "ours" };
    expect(await store.save(doc)).toBe(doc);
  });

  it("puts a person back when a move's household was built before their first save", async () => {
    const disk = memoryDisk();
    const store = await open(household(), disk);
    await store.openProfile("t");
    const mine = await store.openMine();
    const hh = store.household();
    const key = Object.keys(mine.months)[0];
    expect(await store.saveBoth(withExpense(mine, key, { id: "x", name: "Gym", amount: 1, date: "2026-10-04", category: "Uncategorized" }), { ...hh, note: "from" })).toBe(true);
    expect(personIn(disk.household(), "t").hasOwn).toBe(true);
    expect(disk.household().note).toBe("from");
  });
});

describe("keep it as mine", () => {
  function onePerson() {
    const raw = withExpense(household([anna]), "2026-10", { id: "e2", name: "CANARY-7Q", amount: 5, date: "2026-10-04", category: "Groceries", paidBy: "a", paidWith: "visa" });
    raw.recurringTemplate = [{ id: "rt", name: "Netflix", amount: 49, dayOfMonth: 20, category: "Home", paidBy: "a" }];
    return raw;
  }
  function withBackups(raw) {
    const disk = memoryDisk();
    disk.folder("").set("budget-ctrl-2026-10-14-0900-daily.json", JSON.stringify(raw));
    disk.folder("").set("budget-ctrl-2026-10-14-1000-before-import.json", JSON.stringify(raw));
    return disk;
  }

  it("makes the budget the person's own, and starts an empty household with the same categories and people", async () => {
    const raw = onePerson();
    const disk = withBackups(raw);
    const store = await open(raw, disk);
    await store.keepAsMine("a");

    const own = disk.ownBudget("a");
    expect(own.people).toBeUndefined();
    expect(own.months["2026-10"].expenses.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(own.recurringTemplate.map((t) => t.id)).toEqual(["rt"]);
    expect(JSON.stringify(own)).not.toMatch(/paidBy|paidWith/);
    // Her caps stay hers.
    expect(own.categories.find((c) => c.name === "Groceries").cap).toBe(1200);

    const hh = disk.household();
    for (const m of Object.values(hh.months)) {
      expect(m.expenses).toEqual([]);
      expect(m.recurring).toEqual([]);
      expect(m.credits).toEqual([]);
      expect(m.upcoming).toEqual([]);
    }
    expect(hh.recurringTemplate).toEqual([]);
    expect(hh.accounts).toEqual([]);
    expect(hh.categories.map((c) => c.name)).toEqual(raw.categories.map((c) => c.name));
    expect(hh.people).toEqual([{ ...anna, hasOwn: true }]);
    expect(hh.currency).toBe("PLN");
    // This computer's settings still in the budget file stay as they were.
    expect(hh.language).toBe("pl");
    expect(hh.updates).toEqual({ auto: false });
    expect(JSON.stringify(hh)).not.toContain("CANARY-7Q");
    expect(store.household().budgetOf).toBe(HOUSEHOLD);
    expect(store.hasOwn("a")).toBe(true);
    expect(store.profilesOn()).toBe(true);
  });

  it("writes the own file, takes the day's backup, moves the backups, then writes the budget file", async () => {
    const raw = onePerson();
    const disk = withBackups(raw);
    const store = await open(raw, disk);
    await store.keepAsMine("a");
    expect(disk.writes()).toEqual([["writeOwnFile", "a"], ["ensureDailyBackup"], ["moveHouseholdBackupsTo", "a"], ["writeHousehold"]]);
  });

  it("moves the budget file's backups into hers, today's with them, and leaves none of the old budget behind", async () => {
    const raw = onePerson();
    const disk = withBackups(raw);
    const store = await open(raw, disk);
    await store.keepAsMine("a");
    expect([...disk.folder("").keys()]).toEqual([]);
    const hers = [...disk.folder("a").values()].filter((t) => t.includes("CANARY-7Q"));
    // The two from before, and the day's backup of the old budget taken before the move.
    expect(hers).toHaveLength(3);
    // The household's next saves take no backup of their own today.
    await store.save({ ...store.household(), note: "ours" });
    for (const [name, text] of disk.folder("")) expect(text, name).not.toContain("CANARY-7Q");
  });

  it("leaves no canary in the household once the second person is added", async () => {
    const raw = onePerson();
    const disk = withBackups(raw);
    const store = await open(raw, disk);
    await store.keepAsMine("a");
    await store.save(addPerson(store.household(), "Tom", () => "t"));
    expect(disk.files.get(BUDGET_FILE)).not.toContain("CANARY-7Q");
    expect(store.people().map((p) => p.name)).toEqual(["Anna", "Tom"]);
    await store.openProfile("a");
    expect(JSON.stringify(await store.openMine())).toContain("CANARY-7Q");
  });

  it("stops before the household changes when the backups can't be moved, and can be tried again", async () => {
    const raw = onePerson();
    const disk = withBackups(raw);
    const store = await open(raw, disk);
    disk.failing.add("moveHouseholdBackupsTo");
    await expect(store.keepAsMine("a")).rejects.toThrow();
    expect(JSON.stringify(disk.ownBudget("a"))).toContain("CANARY-7Q");
    expect(disk.writes().some(([op]) => op === "writeHousehold")).toBe(false);
    expect(JSON.stringify(store.household())).toContain("CANARY-7Q");
    expect(store.hasOwn("a")).toBe(false);

    disk.failing.delete("moveHouseholdBackupsTo");
    await store.keepAsMine("a");
    expect(disk.files.get(BUDGET_FILE)).not.toContain("CANARY-7Q");
    expect(JSON.stringify(disk.ownBudget("a"))).toContain("CANARY-7Q");
    for (const [name, text] of disk.folder("")) expect(text, name).not.toContain("CANARY-7Q");
  });

  it("won't try again over a Mine the person has saved since", async () => {
    const raw = onePerson();
    const disk = withBackups(raw);
    const store = await open(raw, disk);
    disk.failing.add("moveHouseholdBackupsTo");
    await expect(store.keepAsMine("a")).rejects.toThrow();
    disk.failing.delete("moveHouseholdBackupsTo");
    await store.openProfile("a");
    await store.save({ ...(await store.openMine()), note: "edited since" });
    await expect(store.keepAsMine("a")).rejects.toThrow();
    expect(disk.ownBudget("a").note).toBe("edited since");
  });

  it("never writes over a budget the person already has", async () => {
    const raw = onePerson();
    const disk = withBackups(raw);
    disk.files.set("own-a.json", plainOwn({ ...annasMine(), note: "hers already" }));
    disk.failing.add("listOwnFiles");
    const store = await open(raw, disk);
    expect(store.hasOwn("a")).toBe(false);
    await expect(store.keepAsMine("a")).rejects.toThrow();
    expect(disk.ownBudget("a").note).toBe("hers already");

    const done = await open(onePerson(), withBackups(onePerson()));
    await done.keepAsMine("a");
    await expect(done.keepAsMine("a")).rejects.toThrow();
  });
});

describe("ownFor", () => {
  it("gives a person's budget for export, sealed ones only with their password or code", async () => {
    const { store, code } = await sealedAnna();
    await store.closeProfile();
    expect(await store.ownFor("a")).toBeNull();
    expect(await store.ownFor("a", "wrong horse")).toBeNull();
    expect(JSON.stringify(await store.ownFor("a", "correct horse"))).toContain("CANARY-7Q");
    expect(JSON.stringify(await store.ownFor("a", code.toLowerCase()))).toContain("CANARY-7Q");
    expect(await store.ownFor("t")).toBeNull();
    // A doc handed out this way is never saved into Anna's file from Tom's session.
    await store.openProfile("t");
    const hers = await store.ownFor("a", "correct horse");
    expect(await store.save(hers)).toBe(false);
  });

  it("gives a plain budget without a secret", async () => {
    const { store } = await annaWithMine();
    await store.closeProfile();
    expect(JSON.stringify(await store.ownFor("a"))).toContain("CANARY-7Q");
  });
});
