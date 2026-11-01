// The budget store: the only code that sees more than one budget.
//
// With profiles there are several budgets. The household's is the budget
// file, as it always was. Each person's own budget ("Mine") is a file of its
// own, own-<id>.json, sealed with their password or plain. Everything else in
// the app holds only the one budget that is open and never reads another, so
// this module is the boundary that keeps a private entry out of the household
// and out of anyone else's profile.
//
// Every doc the store hands out is stamped with `budgetOf`: HOUSEHOLD, or the
// person whose own budget it is. The stamp lives only in memory; it is never
// written. A save goes to the file the stamp names and to no other. Routing by
// the stamp, rather than by whichever budget is showing when the save runs, is
// what stops an edit made in Mine from landing in the household after a
// switch: the stamp travels with the doc through every spread the app makes,
// while what is showing can change between the edit and its save. A stamp for
// a budget that isn't open (someone else's, or Mine while it is locked or the
// profile is closed) is refused, and nothing is written.
//
// The household holds nothing from an own budget but `people[i].hasOwn`. The
// marker says a file exists, so a missing or damaged own file gets the
// recovery choices, never a fresh empty Mine that the first save would write
// over the real one. The file itself is always read first, whatever the
// marker says, and one that is there is never replaced by a new Mine.
//
// Every write, and every change to who is open, runs on one queue, one job at
// a time: a save made before Mine locks or the profile closes lands before the
// key is forgotten, and two saves land in the order they were made.

import { defaultData, hydrate, migrate } from "../model.js";
import { serial } from "./backups.js";
import { calendarFor } from "./calendar.js";
import { peopleOf, personById, PERSON_COLORS, removePerson as markRemoved } from "./people.js";
import { deleteTemplate } from "./recurringEdits.js";
import {
  ITERATIONS, RECOVERY_ITERATIONS, newBudgetKey, normalizePassword, normalizeRecoveryCode,
  openSealed, sealBudget, unwrapKey, validPassword, wrapKey,
} from "./vault.js";

export const HOUSEHOLD = "household";

// As storage.js: only such an id names a file. "household" fits the pattern,
// but a person by that id would have their Mine routed to the household.
const PERSON_ID = /^[a-z0-9]{1,40}$/;
const validId = (id) => typeof id === "string" && PERSON_ID.test(id) && id !== HOUSEHOLD;

// own-<id>.json holds { v, budget } when plain, and { v, sealed, password,
// recovery } when sealed: the budget encrypted with a random key, and that key
// wrapped once by the password and once by the recovery code. `v` sits outside
// the seal, so the format can be told without the key.
const FORMAT = 1;

// `reason` is "missing" when the household marks a file that isn't there
// (with two computers, it may not have synced yet) and "damaged" when the file
// is there and can't be read. `keptAs` names the copy of a damaged file kept
// beside it, or is null when no copy could be made.
export class OwnUnreadableError extends Error {
  constructor(personId, reason, keptAs = null) {
    super(reason === "missing" ? "This person's own budget file isn't there" : "This person's own budget file can't be read");
    this.name = "OwnUnreadableError";
    this.personId = personId;
    this.reason = reason;
    this.keptAs = keptAs;
  }
}

const isObject = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const without = (obj, ...keys) => {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
};
const stamped = (doc, id) => ({ ...doc, budgetOf: id });
// What a file holds: no stamp, and no `own`, which could only hold an own
// budget and so never goes into a file.
const bare = (doc) => without(doc, "budgetOf", "own");

const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// A person's new own budget: empty, in the household's currency and number
// format, paid on the household's schedule, with its categories. Caps are
// left behind, since what the household caps isn't what one person spends.
export function newOwnBudget(household) {
  const h = household || {};
  return hydrate({
    ...hydrate(defaultData()),
    // The empty period defaultData made is the running one on a monthly
    // calendar from the 1st; hydrate makes the running one on this budget's.
    months: {},
    currency: h.currency,
    locale: h.locale,
    cutoffDay: h.cutoffDay,
    ...(h.paySchedule ? { paySchedule: structuredClone(h.paySchedule) } : {}),
    creditCategories: h.creditCategories ? structuredClone(h.creditCategories) : undefined,
    categories: (h.categories || []).map((c) => without(c, "cap")),
    setupDone: true,
  });
}

// The household as one person's own budget, for "Keep it as mine" and for a
// backup of the budget file that it moved into theirs: everything but the
// people, and nobody marked as having paid, since there is nobody else.
function asOwnBudget(household) {
  const doc = without(bare(household), "people");
  const unpaid = (list) => (Array.isArray(list) ? list.map((e) => without(e, "paidBy", "paidWith")) : list);
  const months = {};
  for (const [k, m] of Object.entries(doc.months || {})) {
    months[k] = { ...m, expenses: unpaid(m.expenses), recurring: unpaid(m.recurring), upcoming: unpaid(m.upcoming), credits: unpaid(m.credits) };
  }
  return { ...doc, months, recurringTemplate: unpaid(doc.recurringTemplate), creditTemplate: unpaid(doc.creditTemplate) };
}

// An own file's text as { kind: "plain", budget } or { kind: "sealed",
// sealed, password, recovery }; null for anything else, a newer format
// included, which is never written over as if it were empty.
function parseOwn(text) {
  let f;
  try { f = JSON.parse(text); } catch { return null; }
  if (!isObject(f) || f.v !== FORMAT) return null;
  if (isObject(f.budget)) return { kind: "plain", budget: f.budget };
  if (isObject(f.sealed) && isObject(f.password)) return { kind: "sealed", sealed: f.sealed, password: f.password, recovery: isObject(f.recovery) ? f.recovery : null };
  return null;
}

// A backup of Mine is an own file, or a backup of the budget file that "Keep
// it as mine" moved in (a budget with no `v`), read as the own budget it became.
function parseBackup(text) {
  const own = parseOwn(text);
  if (own) return own;
  let f;
  try { f = JSON.parse(text); } catch { return null; }
  return isObject(f) && !("v" in f) && isObject(f.months) ? { kind: "plain", budget: asOwnBudget(f) } : null;
}

const plainText = (doc) => JSON.stringify({ v: FORMAT, budget: bare(doc) });
const sealedText = async (doc, key, wraps) => JSON.stringify({
  v: FORMAT, sealed: await sealBudget(bare(doc), key), password: wraps.password, recovery: wraps.recovery,
});

// Whose shares end when they leave: a household recurring credit marked as
// their contribution. Its copies go from the running period on (the running
// one's here, later ones through deleteTemplate); earlier ones are history.
function endShares(doc, pid) {
  const shares = (doc.creditTemplate || []).filter((t) => t.contribution === true && t.paidBy === pid);
  if (!shares.length) return doc;
  const running = calendarFor(doc).current();
  let out = doc;
  for (const t of shares) {
    const cur = out.months?.[running];
    if (cur) out = { ...out, months: { ...out.months, [running]: { ...cur, credits: (cur.credits || []).filter((c) => c.templateId !== t.id) } } };
    out = deleteTemplate(out, "credits", running, t.id);
  }
  return out;
}

// A colour nobody has, as addPerson picks one.
function freeColor(people) {
  const used = new Set(people.map((p) => p.color));
  return PERSON_COLORS.find((c) => !used.has(c)) || PERSON_COLORS[people.length % PERSON_COLORS.length];
}

// Everyone with an own file on disk is a current person marked hasOwn. A
// household restored from a backup older than them, or taken from the
// recovery screen, would otherwise hide their file. Someone the household
// doesn't know at all comes back under their id, to be renamed.
function withOwners(doc, ids) {
  let people = doc.people || [];
  let changed = false;
  for (const id of ids) {
    if (!validId(id)) continue;
    const p = people.find((q) => q.id === id);
    if (p && !p.removed && p.hasOwn) continue;
    if (p) {
      people = people.map((q) => (q === p ? { ...without(p, "removed"), hasOwn: true } : q));
    } else {
      people = [...people, { id, name: id, color: freeColor(people), hasOwn: true }];
    }
    changed = true;
  }
  return changed ? { ...doc, people } : doc;
}

// Language and updates are this computer's settings, still kept in the budget
// file. An emptied household keeps them, or the app would change under you.
const computerSettings = (doc) => Object.fromEntries(["language", "updates"].filter((k) => k in doc).map((k) => [k, doc[k]]));

export async function createStore(raw, { io, iterations = ITERATIONS, recoveryIterations = RECOVERY_ITERATIONS } = {}) {
  let hh = stamped(bare(hydrate(migrate(raw))), HOUSEHOLD);
  let listFault = null;
  try {
    hh = withOwners(hh, await io.listOwnFiles());
  } catch (err) {
    // Starting the app matters more. The household's own markers still guard
    // every file they name, and a file they miss is still read before Mine is
    // made; the app can say the listing failed.
    listFault = err;
  }

  let session = null; // the open profile's person id
  let mine = null; // their own budget, stamped, while it is open
  let key = null; // its budget key, while it is open and sealed
  let wraps = null; // { password, recovery }, written beside every seal
  let mustSet = false; // opened with the recovery code: a new password is due
  let keptFor = null; // keepAsMine wrote this person's file and stopped before the household
  const damaged = new Map(); // person id → the text of their sealed file found damaged, and kept
  const sealedBackups = new Set(); // "<pid>/<name>": backups seen sealed, never read again
  const plainLeft = new Map(); // person id → backups still plain after the last try to seal them

  const queue = serial((job) => job());

  const forgetMine = () => {
    mine = null;
    key = null;
    wraps = null;
    mustSet = false;
  };
  const closeNow = () => {
    forgetMine();
    session = null;
  };

  const textOf = (doc) => JSON.stringify(bare(doc));

  function stampOf(doc) {
    if (!isObject(doc) || typeof doc.budgetOf !== "string" || !doc.budgetOf) throw new Error("A budget to save must say whose it is");
    return doc.budgetOf;
  }

  // Checked when the save runs, not when it is asked for: a save queued
  // before Mine locks still finds it open, and one queued after doesn't.
  const opens = (to) => to === HOUSEHOLD || (to === session && mine !== null);

  function mustBeCurrent(pid) {
    const p = personById(hh, pid);
    if (!p || p.removed) throw new Error("That person isn't in the household");
    if (!validId(pid)) throw new Error("That person can't have a profile");
  }

  // What the person's file holds, read afresh whatever the marker says.
  async function readOwn(pid) {
    if (!validId(pid)) throw new Error("That person can't have a budget of their own");
    const file = await io.readOwnFile(pid);
    if (file.status === "missing") {
      if (personById(hh, pid)?.hasOwn) throw new OwnUnreadableError(pid, "missing");
      return { kind: "none" };
    }
    const parsed = file.status === "ok" ? parseOwn(file.text) : null;
    if (!parsed) throw new OwnUnreadableError(pid, "damaged", file.keptAs ?? null);
    return { ...parsed, text: file.text };
  }

  const loadMine = (budget, pid) => stamped(bare(hydrate(migrate(budget))), pid);

  // Opens a sealed file with a key from unwrapKey. A wrong secret gives no
  // key, and false. unwrapKey's own faults are left to reject: they are never
  // a wrong password. A key the secret did unwrap that doesn't open the data
  // means the data is damaged (changed on disk, or a wrapper copied in from
  // another file): its text is kept, as the read path keeps damage, the
  // profile opens for the household as it does over any damaged file, and the
  // error lets the person restore a backup or start again.
  async function openWithKey(pid, file, k) {
    if (!k) return false;
    let doc = null;
    try { doc = await openSealed(file.sealed, k); } catch { /* damage, below */ }
    if (!isObject(doc)) {
      session = pid;
      const keptAs = await io.keepOwnUnreadable(pid, file.text);
      if (keptAs) damaged.set(pid, file.text);
      throw new OwnUnreadableError(pid, "damaged", keptAs);
    }
    session = pid;
    key = k;
    wraps = { password: file.password, recovery: file.recovery };
    mine = loadMine(doc, pid);
    return true;
  }

  // The first write of someone's file marks them in the household. The seal
  // in memory changes only once the file has it, so a failed write never
  // leaves the next save sealing differently from what is on disk. Every
  // sealed write also seals what is still plain among Mine's backups.
  async function writeMine(doc, k = key, w = wraps) {
    await io.writeOwnFile(session, k ? await sealedText(doc, k, w) : plainText(doc));
    key = k;
    wraps = k ? w : null;
    damaged.delete(session);
    const me = personById(hh, session);
    // Someone the household has since removed is marked by the listing when
    // the app next starts, rather than here on every save.
    if (me && !me.removed && !me.hasOwn) {
      hh = { ...hh, people: (hh.people || []).map((p) => (p.id === session ? { ...p, hasOwn: true } : p)) };
      await io.writeHousehold(textOf(hh));
    }
    if (k) await sealBackups(session, k, w);
    else plainLeft.delete(session);
  }

  // A household doc keeps its people: nobody with an own file vanishes (an old
  // backup restored, an import, a reset), and someone removed and now back
  // gets their set-aside budget back.
  async function keepPeople(doc) {
    const before = hh.people || [];
    let people = doc.people || [];
    let kept = false;
    for (const p of before) {
      if (!p.hasOwn || p.removed) continue;
      const q = people.find((x) => x.id === p.id);
      if (q && !q.removed && q.hasOwn) continue;
      people = q ? people.map((x) => (x === q ? p : x)) : [...people, p];
      kept = true;
    }
    const back = people.filter((q) => !q.removed && validId(q.id) && personById(hh, q.id)?.removed).map((q) => q.id);
    for (const pid of back) {
      if (!(await io.restoreSetAsideOwnFile(pid))) continue;
      people = people.map((x) => (x.id === pid ? { ...x, hasOwn: true } : x));
      kept = true;
    }
    if (kept) return stamped({ ...bare(doc), people }, HOUSEHOLD);
    return "own" in doc ? stamped(bare(doc), HOUSEHOLD) : doc;
  }

  // The store's doc is the one asked for even if its write fails, as the
  // app's is: the next save that works writes it. The failure still rejects.
  async function saveNow(doc) {
    if (doc.budgetOf !== HOUSEHOLD) {
      mine = doc;
      await writeMine(doc);
      return doc;
    }
    const next = await keepPeople(doc);
    hh = next;
    await io.writeHousehold(textOf(next));
    return next;
  }

  function needSealedMine() {
    if (!session || !mine) throw new Error("Mine isn't open");
    if (!key) throw new Error("Mine has no password");
  }
  const provesPassword = async (pw) => {
    const k = await unwrapKey(wraps.password, normalizePassword(pw));
    return !!k && sameBytes(k, key);
  };
  const wrapPassword = (k, pw) => {
    if (!validPassword(pw)) throw new Error("That password is too short");
    return wrapKey(k, normalizePassword(pw), iterations);
  };
  const wrapCode = (k, code) => wrapKey(k, normalizeRecoveryCode(code), recoveryIterations);

  // Writing over Mine is allowed only when nothing would be lost: there is no
  // file, or it is damaged and its text was kept. That includes a sealed file
  // found damaged and kept, while it still holds that same text. A file that
  // can't be read just now (locked by a sync client, say) is never written over.
  async function mustBeReplaceable(pid) {
    const file = await io.readOwnFile(pid);
    if (file.status === "missing" || (file.status === "unreadable" && file.keptAs)) return;
    if (file.status === "ok" && damaged.get(pid) === file.text) return;
    throw new Error(file.status === "ok"
      ? "This own budget's file opens, so it isn't written over"
      : "The damaged file couldn't be kept, so it isn't written over");
  }

  // No plain copy of a sealed Mine is left among its backups: those from
  // before the password, the budget file's that "Keep it as mine" moved in,
  // and any that failed to seal last time. Each is sealed in place. One that
  // isn't a budget is sealed as its text, so that isn't left plain either. A
  // backup seen sealed isn't read again, so a save reads only what is new.
  // A failure never fails the write that asked: it is counted for the person
  // to be told, and tried again at the next sealed save.
  async function sealBackups(pid, k, w) {
    let names;
    try { names = await io.listOwnBackups(pid); } catch { return; }
    let left = 0;
    for (const name of names) {
      const id = `${pid}/${name}`;
      if (sealedBackups.has(id)) continue;
      try {
        const text = await io.readOwnBackup(pid, name);
        const backup = parseBackup(text);
        if (backup?.kind !== "sealed") {
          await io.replaceOwnBackup(pid, name, await sealedText(backup ? backup.budget : { damagedBackup: text }, k, w));
        }
        sealedBackups.add(id);
      } catch {
        left += 1;
      }
    }
    plainLeft.set(pid, left);
  }

  return {
    listFault,

    household: () => hh,
    householdText: () => textOf(hh),
    profilesOn: () => {
      const current = peopleOf(hh);
      return current.length >= 2 || current.some((p) => p.hasOwn);
    },
    people: () => peopleOf(hh),
    hasOwn: (pid) => !!personById(hh, pid)?.hasOwn,
    session: () => session,
    mineOpen: () => mine !== null,
    mustSetPassword: () => mustSet,
    // How many of the open person's backups the last sealed save couldn't seal.
    plainBackupsLeft: () => (session ? plainLeft.get(session) ?? 0 : 0),
    own: () => mine,
    doc: (id) => (id === HOUSEHOLD ? hh : id && id === session ? mine : null),

    ownStatus: (pid) => queue(async () => (await readOwn(pid)).kind),

    // A profile with a damaged or missing own file still opens, for the
    // household; openMine then says what is wrong.
    openProfile: (pid, password) => queue(async () => {
      closeNow();
      mustBeCurrent(pid);
      let file;
      try {
        file = await readOwn(pid);
      } catch (err) {
        if (!(err instanceof OwnUnreadableError)) throw err;
        session = pid;
        return true;
      }
      if (file.kind !== "sealed") {
        session = pid;
        return true;
      }
      return openWithKey(pid, file, await unwrapKey(file.password, normalizePassword(password)));
    }),

    openWithRecovery: (pid, code) => queue(async () => {
      closeNow();
      mustBeCurrent(pid);
      const file = await readOwn(pid);
      if (file.kind !== "sealed" || !file.recovery) return false;
      if (!(await openWithKey(pid, file, await unwrapKey(file.recovery, normalizeRecoveryCode(code))))) return false;
      mustSet = true;
      return true;
    }),

    // Nothing is written until the first save, so opening Mine to look
    // leaves no file and no marker behind.
    openMine: () => queue(async () => {
      if (!session) throw new Error("No profile is open");
      if (mine) return mine;
      const file = await readOwn(session);
      if (file.kind === "sealed") throw new Error("Mine is locked: it opens with the password");
      key = null;
      wraps = null;
      mine = file.kind === "plain" ? loadMine(file.budget, session) : stamped(newOwnBudget(hh), session);
      return mine;
    }),

    unlockMine: (password) => queue(async () => {
      if (!session) throw new Error("No profile is open");
      if (mine) return true;
      const file = await readOwn(session);
      if (file.kind !== "sealed") return false;
      return openWithKey(session, file, await unwrapKey(file.password, normalizePassword(password)));
    }),

    lockMine: () => queue(async () => forgetMine()),
    closeProfile: () => queue(async () => closeNow()),

    async save(doc) {
      const to = stampOf(doc);
      return queue(async () => (opens(to) ? saveNow(doc) : false));
    },

    // One job, so nothing can come between the two. The target goes first: if
    // the second write fails, the entry is in both budgets, never in neither.
    async saveBoth(first, second) {
      const a = stampOf(first);
      const b = stampOf(second);
      return queue(async () => {
        if (!opens(a) || !opens(b)) return false;
        await saveNow(first);
        await saveNow(second);
        return true;
      });
    },

    // Nothing is destroyed, so no password is needed: their file is put away
    // as it is, sealed or not, and comes back if they are added again.
    removePerson: (pid) => queue(async () => {
      if (session === pid) closeNow();
      const before = hh;
      const asideAs = validId(pid) ? await io.setAsideOwnFile(pid) : null;
      const gone = markRemoved(hh, pid);
      const people = gone.people.map((p) => (p.id === pid ? without(p, "hasOwn") : p));
      hh = endShares({ ...gone, people }, pid);
      try {
        await io.writeHousehold(textOf(hh));
      } catch (err) {
        // The household on disk still has them, with their marker; their file
        // goes back where it says it is.
        hh = before;
        if (asideAs) await io.restoreSetAsideOwnFile(pid).catch(() => {});
        throw err;
      }
      if (validId(pid)) await io.forgetPrivateDue(pid);
    }),

    // For an export before removing someone. `secret` is their password or
    // their recovery code.
    ownFor: (pid, secret) => queue(async () => {
      if (pid === session && mine) return mine;
      const file = await readOwn(pid);
      if (file.kind === "none") return null;
      if (file.kind === "plain") return loadMine(file.budget, pid);
      if (typeof secret !== "string" || !secret) return null;
      const k = (await unwrapKey(file.password, normalizePassword(secret)))
        || (file.recovery ? await unwrapKey(file.recovery, normalizeRecoveryCode(secret)) : null);
      if (!k) return null;
      try {
        const doc = await openSealed(file.sealed, k);
        return isObject(doc) ? loadMine(doc, pid) : null;
      } catch {
        return null;
      }
    }),

    // The household becomes `pid`'s own budget, and an empty household with
    // the same people and categories takes its place. Its backups go with it:
    // they hold what is now theirs, and left behind anyone could restore them
    // into the household. The own file comes first, so a stop part way leaves
    // the entries in both, never in neither. A failed move stops before the
    // household changes, and can be tried again.
    keepAsMine: (pid) => queue(async () => {
      mustBeCurrent(pid);
      // An own budget already there is never written over. The only file
      // allowed is the one an earlier try of this wrote, and only until the
      // person saves Mine, which marks them.
      if (personById(hh, pid).hasOwn || (keptFor !== pid && (await readOwn(pid)).kind !== "none")) {
        throw new Error("This person already has a budget of their own");
      }
      const old = hh;
      keptFor = pid;
      await io.writeOwnFile(pid, plainText(asOwnBudget(old)));
      // The day's first save backs up the budget file as it was, which would
      // be the old budget, left behind after the move. Taken now, it moves
      // with the rest, and the household's save takes none today.
      await io.ensureDailyBackup();
      await io.moveHouseholdBackupsTo(pid);
      keptFor = null;
      const people = (old.people || []).map((p) => (p.id === pid ? { ...p, hasOwn: true } : p));
      hh = stamped({ ...newOwnBudget(old), ...computerSettings(old), people }, HOUSEHOLD);
      if (session === pid) forgetMine();
      await io.writeHousehold(textOf(hh));
    }),

    // The first password. The UI has shown the recovery code before this is
    // called. Mine's file is sealed first, so the backup that write takes of
    // the plain file is among the backups sealed after it. A backup that
    // won't seal doesn't fail the call (plainBackupsLeft says so); the next
    // save tries it again.
    setPassword: (pw, code) => queue(async () => {
      if (!session || !mine) throw new Error("Mine isn't open");
      if (key) throw new Error("Mine has a password already");
      const k = newBudgetKey();
      await writeMine(mine, k, { password: await wrapPassword(k, pw), recovery: await wrapCode(k, code) });
    }),

    // The same key under a new password, so older backups still open with the
    // old one. `newKey` (the old password may be known) seals Mine with a new
    // key, which needs a new recovery code too.
    changePassword: (current, next, { newKey = false, code } = {}) => queue(async () => {
      needSealedMine();
      if (!(await provesPassword(current))) return false;
      if (!newKey) {
        await writeMine(mine, key, { ...wraps, password: await wrapPassword(key, next) });
        return true;
      }
      if (!normalizeRecoveryCode(code)) throw new Error("A new key needs a new recovery code");
      const k = newBudgetKey();
      await writeMine(mine, k, { password: await wrapPassword(k, next), recovery: await wrapCode(k, code) });
      return true;
    }),

    setNewPassword: (next, code) => queue(async () => {
      if (!mustSet || !mine || !key) return false;
      await writeMine(mine, key, { password: await wrapPassword(key, next), recovery: await wrapCode(key, code) });
      mustSet = false;
      return true;
    }),

    removePassword: (current) => queue(async () => {
      needSealedMine();
      if (!(await provesPassword(current))) return false;
      await writeMine(mine, null, null);
      return true;
    }),

    newRecoveryCode: (current, code) => queue(async () => {
      needSealedMine();
      if (!(await provesPassword(current))) return false;
      await writeMine(mine, key, { ...wraps, recovery: await wrapCode(key, code) });
      return true;
    }),

    // A backup opens plain, with the key held now, or with `password` through
    // its own wrapper. With a key held it is written under the current
    // password; otherwise sealed as it was. Mine must be open, or its file
    // missing or damaged and kept, so nothing that opens is written over.
    restoreMine: (name, password) => queue(async () => {
      if (!session) throw new Error("No profile is open");
      if (!mine) await mustBeReplaceable(session);
      const backup = parseBackup(await io.readOwnBackup(session, name));
      if (!backup) return null;
      let doc = backup.kind === "plain" ? backup.budget : null;
      let seal = { k: key, w: wraps };
      if (backup.kind === "sealed") {
        if (key) doc = await openSealed(backup.sealed, key).catch(() => null);
        if (!isObject(doc)) {
          const k = await unwrapKey(backup.password, normalizePassword(password));
          if (!k) return null;
          doc = await openSealed(backup.sealed, k).catch(() => null);
          if (!key) seal = { k, w: { password: backup.password, recovery: backup.recovery } };
        }
      }
      // A damaged backup was sealed as its text, which is no budget to restore.
      if (!isObject(doc) || "damagedBackup" in doc) return null;
      const restored = loadMine(doc, session);
      await writeMine(restored, seal.k, seal.w);
      mine = restored;
      return restored;
    }),

    // After an OwnUnreadableError: an empty Mine, written now so the damaged
    // or missing file stops standing in its way. Plain, as nothing is known
    // of the old password.
    startMineAgain: () => queue(async () => {
      if (!session) throw new Error("No profile is open");
      await mustBeReplaceable(session);
      const fresh = stamped(newOwnBudget(hh), session);
      await writeMine(fresh, null, null);
      mine = fresh;
      return fresh;
    }),
  };
}
