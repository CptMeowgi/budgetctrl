import { describe, it, expect, vi, afterEach } from "vitest";
import {
  JOINT, PERSON_COLORS, LAST_PAYER_KEY,
  peopleOf, isShared, addPerson, renamePerson, removePerson, personById,
  waysToPay, cleanPayer, payerForAccount, payerParts, spendingByPerson, payerRows, anyoneNamed, readLastPayer, rememberPayer,
} from "./people.js";

// Paid on the 1st; today is 20 Oct 2026.
const TODAY = new Date(2026, 9, 20, 12);

const anna = { id: "a", name: "Anna", color: PERSON_COLORS[0] };
const tom = { id: "t", name: "Tom", color: PERSON_COLORS[1] };

// Anna and Tom, with a card each, a joint account and some cash that nobody owns.
const base = () => ({
  people: [anna, tom],
  accounts: [
    { id: "visa", name: "Visa", kind: "card", owner: "a", balances: [] },
    { id: "debit", name: "Debit", kind: "current", owner: "t", balances: [] },
    { id: "joint", name: "Joint", kind: "current", owner: JOINT, balances: [] },
    { id: "cash", name: "Cash", kind: "cash", balances: [] },
  ],
});

const emptyMonth = (o = {}) => ({ income: 3000, expenses: [], recurring: [], upcoming: [], credits: [], ...o });

// Expenses of 50 (Anna) and 20 (no payer); rent of 900 (joint, due on the 2nd);
// an upcoming bill of 30 (Tom, paid).
const month = emptyMonth({
  expenses: [
    { id: "e1", name: "Shop", amount: 50, date: "2026-10-03", category: "Food", paidBy: "a" },
    { id: "e2", name: "Kiosk", amount: 20, date: "2026-10-04", category: "Food" },
  ],
  recurring: [{ id: "r1", name: "Rent", amount: 900, dayOfMonth: 2, category: "Home", paidBy: JOINT }],
  upcoming: [{ id: "u1", name: "Phone", amount: 30, dueDate: "2026-10-12", category: "Bills", paid: true, paidBy: "t" }],
});

// One receipt paid by Anna: 30 Food and 20 Gifts.
const splitMonth = emptyMonth({
  expenses: [{
    id: "s1", name: "Market", amount: 50, date: "2026-10-05", category: "Food", paidBy: "a",
    splits: [{ category: "Food", amount: 30 }, { category: "Gifts", amount: 20 }],
  }],
});

describe("people", () => {
  it("is shared from two people, not counting removed ones", () => {
    expect(isShared({ people: [anna] })).toBe(false);
    expect(isShared({ people: [anna, tom] })).toBe(true);
    expect(isShared(removePerson({ people: [anna, tom] }, "t"))).toBe(false);
  });

  it("is not shared in a budget with no people at all", () => {
    expect(isShared({})).toBe(false);
    expect(peopleOf({})).toEqual([]);
    expect(peopleOf(null)).toEqual([]);
  });

  it("adds people with the next free colour and a trimmed name", () => {
    const d = addPerson(addPerson({}, "  Anna ", () => "a"), "Tom", () => "t");
    expect(d.people.map((p) => [p.name, p.color])).toEqual([["Anna", PERSON_COLORS[0]], ["Tom", PERSON_COLORS[1]]]);
    expect(addPerson(d, "  ", () => "x")).toBe(d);
  });

  it("gives a new person the first colour not in use", () => {
    expect(addPerson(base(), "Zoe", () => "z").people[2].color).toBe(PERSON_COLORS[2]);
  });

  it("does not give a new person the colour of someone who was removed", () => {
    // Anna holds the first colour but is removed; Tom has no colour of his own.
    const d = { people: [{ id: "a", name: "Anna", color: PERSON_COLORS[0], removed: true }, { id: "t", name: "Tom" }] };
    expect(personById(addPerson(d, "Cara", () => "c"), "c").color).toBe(PERSON_COLORS[1]);
  });

  it("reuses a removed person's colour only once all six are taken", () => {
    let d = {};
    for (let i = 0; i < PERSON_COLORS.length; i++) d = addPerson(d, `P${i}`, () => `p${i}`);
    expect(d.people.map((p) => p.color)).toEqual(PERSON_COLORS);
    // The fourth leaves: theirs is the one colour no current person has.
    expect(personById(addPerson(removePerson(d, "p3"), "New", () => "n"), "n").color).toBe(PERSON_COLORS[3]);
  });

  it("starts the colours over when every one is in use by current people", () => {
    let d = {};
    for (let i = 0; i < PERSON_COLORS.length + 2; i++) d = addPerson(d, `P${i}`, () => `p${i}`);
    expect(d.people).toHaveLength(PERSON_COLORS.length + 2);
    // Seventh: PERSON_COLORS[6 % 6]; eighth: PERSON_COLORS[7 % 6].
    expect(d.people[PERSON_COLORS.length].color).toBe(PERSON_COLORS[0]);
    expect(d.people[PERSON_COLORS.length + 1].color).toBe(PERSON_COLORS[1]);
  });

  it("brings back a removed person added again, with the same id and colour", () => {
    // Tom left with a card of his and an old entry; adding "tom" again is him, not a second Tom.
    const entry = { id: "e9", name: "Fuel", amount: 40, date: "2026-10-06", category: "Transport", paidBy: "t" };
    const gone = removePerson({ ...base(), months: { "2026-10": emptyMonth({ expenses: [entry] }) } }, "t");
    const newId = vi.fn(() => "t2");
    const d = addPerson(gone, " tom ", newId);
    expect(newId).not.toHaveBeenCalled();
    expect(d.people).toHaveLength(2);
    expect(personById(d, "t")).toEqual({ id: "t", name: "tom", color: tom.color });
    expect(peopleOf(d).map((p) => p.id)).toEqual(["a", "t"]);
    expect(waysToPay(d, "t").map((x) => x.id)).toEqual(["debit", "cash"]);
    const byPayer = spendingByPerson(d.months["2026-10"], "2026-10", TODAY, 1);
    expect(payerRows(d, byPayer)).toEqual([{ payer: "t", amount: 40 }]);
    expect(isShared(d)).toBe(true);
  });

  it("brings back a removed person under the spelling just typed", () => {
    const d = addPerson(removePerson(base(), "t"), "TOM", () => "x");
    expect(personById(d, "t").name).toBe("TOM");
    expect(personById(d, "t").removed).toBeUndefined();
    expect("removed" in personById(d, "t")).toBe(false);
  });

  it("still adds someone new when the name matches a current person", () => {
    const d = addPerson(base(), "tom", () => "t2");
    expect(peopleOf(d).map((p) => p.id)).toEqual(["a", "t", "t2"]);
  });

  it("adds someone new when the name matches nobody removed", () => {
    const d = addPerson(removePerson(base(), "t"), "Tomas", () => "t2");
    expect(d.people.map((p) => [p.id, !!p.removed])).toEqual([["a", false], ["t", true], ["t2", false]]);
  });

  it("renames a person, trimmed, and ignores an empty name", () => {
    const d = renamePerson(base(), "a", "  Ania ");
    expect(personById(d, "a").name).toBe("Ania");
    expect(personById(d, "t").name).toBe("Tom");
    expect(renamePerson(base(), "a", "   ").people.map((p) => p.name)).toEqual(["Anna", "Tom"]);
  });

  it("keeps a removed person's name on their old entries", () => {
    const d = removePerson(base(), "a");
    expect(peopleOf(d).map((p) => p.id)).toEqual(["t"]);
    expect(payerParts(d, { paidBy: "a", paidWith: "visa" })).toEqual({ who: "Anna", how: "Visa" });
  });

  it("finds a person by id, removed ones included, or null", () => {
    expect(personById(base(), "t")).toEqual(tom);
    expect(personById(removePerson(base(), "t"), "t")).toMatchObject({ id: "t", name: "Tom", removed: true });
    expect(personById(base(), "ghost")).toBeNull();
    expect(personById({}, "a")).toBeNull();
  });
});

describe("waysToPay", () => {
  it("offers each person their own accounts and shared ones", () => {
    expect(waysToPay(base(), "a").map((x) => x.id)).toEqual(["visa", "cash"]);
    expect(waysToPay(base(), JOINT).map((x) => x.id)).toEqual(["joint", "cash"]);
  });

  it("offers every open account when nobody is picked", () => {
    expect(waysToPay(base()).map((x) => x.id)).toEqual(["visa", "debit", "joint", "cash"]);
    expect(waysToPay(base(), "").map((x) => x.id)).toEqual(["visa", "debit", "joint", "cash"]);
  });

  it("leaves out closed accounts", () => {
    const d = base();
    d.accounts[0] = { ...d.accounts[0], closed: true };
    expect(waysToPay(d, "a").map((x) => x.id)).toEqual(["cash"]);
    expect(waysToPay(d).map((x) => x.id)).toEqual(["debit", "joint", "cash"]);
  });
});

describe("cleanPayer", () => {
  it("drops a way to pay that isn't the payer's", () => {
    expect(cleanPayer({ paidBy: "a", paidWith: "debit" }, base())).toEqual({ paidBy: "a" });
    expect(cleanPayer({ paidBy: "", paidWith: "" }, base())).toEqual({});
    expect(cleanPayer({ paidBy: "ghost" }, base())).toEqual({});
    expect(cleanPayer({ paidBy: "a" }, removePerson(base(), "a"))).toEqual({ paidBy: "a" });
  });

  it("keeps a payer and a way to pay that go together", () => {
    expect(cleanPayer({ paidBy: "a", paidWith: "visa" }, base())).toEqual({ paidBy: "a", paidWith: "visa" });
    expect(cleanPayer({ paidBy: "a", paidWith: "cash" }, base())).toEqual({ paidBy: "a", paidWith: "cash" });
    expect(cleanPayer({ paidBy: JOINT, paidWith: "joint" }, base())).toEqual({ paidBy: JOINT, paidWith: "joint" });
  });

  it("checks a way to pay against every open account when no one paid", () => {
    expect(cleanPayer({ paidWith: "debit" }, base())).toEqual({ paidWith: "debit" });
    expect(cleanPayer({ paidWith: "gone" }, base())).toEqual({});
  });

  it("keeps a closed account on an old entry, as it keeps a removed person", () => {
    const d = base();
    d.accounts[0] = { ...d.accounts[0], closed: true };
    expect(cleanPayer({ paidBy: "a", paidWith: "visa" }, d)).toEqual({ paidBy: "a", paidWith: "visa" });
    // It isn't offered for a new entry, though.
    expect(waysToPay(d, "a").map((x) => x.id)).toEqual(["cash"]);
  });

  it("drops an account that is gone, or is someone else's even when closed", () => {
    const d = base();
    d.accounts[1] = { ...d.accounts[1], closed: true };
    expect(cleanPayer({ paidBy: "a", paidWith: "deleted" }, d)).toEqual({ paidBy: "a" });
    expect(cleanPayer({ paidBy: "a", paidWith: "debit" }, d)).toEqual({ paidBy: "a" });
  });

  it("keeps nothing it wasn't given", () => {
    expect(cleanPayer({}, base())).toEqual({});
    expect(cleanPayer({ paidBy: undefined, paidWith: undefined }, base())).toEqual({});
  });
});

describe("payerForAccount", () => {
  it("is the owner of an account that has one", () => {
    expect(payerForAccount(base(), "visa")).toBe("a");
    expect(payerForAccount(base(), "debit")).toBe("t");
  });

  it("is Joint for a joint account", () => {
    expect(payerForAccount(base(), "joint")).toBe(JOINT);
  });

  it("is nothing for an account nobody owns, or one that is gone", () => {
    expect(payerForAccount(base(), "cash")).toBeUndefined();
    expect(payerForAccount(base(), "ghost")).toBeUndefined();
    expect(payerForAccount(base(), "")).toBeUndefined();
    expect(payerForAccount(base(), undefined)).toBeUndefined();
    expect(payerForAccount({}, "visa")).toBeUndefined();
  });

  it("is nothing when the owner is no longer anyone in the budget", () => {
    const d = { ...base(), accounts: [{ id: "x", name: "X", owner: "ghost" }] };
    expect(payerForAccount(d, "x")).toBeUndefined();
  });

  it("is a removed owner, as cleanPayer keeps one", () => {
    expect(payerForAccount(removePerson(base(), "a"), "visa")).toBe("a");
  });
});

describe("payerParts", () => {
  it("names just the person when the account is gone", () => {
    const d = { ...base(), accounts: [] };
    expect(payerParts(d, { paidBy: "a", paidWith: "visa" })).toEqual({ who: "Anna", how: null });
    expect(payerParts(d, { paidBy: JOINT })).toEqual({ who: JOINT, how: null });
  });

  it("is empty for an entry with no payer", () => {
    expect(payerParts(base(), {})).toEqual({ who: null, how: null });
    expect(payerParts(base(), { paidBy: "ghost" })).toEqual({ who: null, how: null });
  });

  it("names the account even when no one is marked as paying", () => {
    expect(payerParts(base(), { paidWith: "cash" })).toEqual({ who: null, how: "Cash" });
  });
});

describe("spendingByPerson", () => {
  it("adds up spending by who paid, with what nobody was marked for under ''", () => {
    // expenses 50 (a) and 20 (no payer); recurring 900 (joint, due); upcoming 30 (t, paid)
    expect([...spendingByPerson(month, "2026-10", TODAY, 1)]).toEqual([["a", 50], ["", 20], [JOINT, 900], ["t", 30]]);
  });

  it("leaves out categories it's told to, split parts included", () => {
    // a split expense paid by a: 30 Food + 20 Gifts
    expect(spendingByPerson(splitMonth, "2026-10", TODAY, 1, { leaveOut: new Set(["Gifts"]) }).get("a")).toBe(30);
  });

  it("counts a split expense in full when nothing is left out", () => {
    expect(spendingByPerson(splitMonth, "2026-10", TODAY, 1).get("a")).toBe(50);
  });

  it("does not count a recurring bill before it is due", () => {
    const early = new Date(2026, 9, 1, 12);
    expect(spendingByPerson(month, "2026-10", early, 1).has(JOINT)).toBe(false);
  });

  it("is empty for a period with no spending", () => {
    expect(spendingByPerson(emptyMonth(), "2026-10", TODAY, 1).size).toBe(0);
    expect(spendingByPerson(undefined, "2026-10", TODAY, 1).size).toBe(0);
  });
});

describe("payerRows", () => {
  const zed = { id: "z", name: "Zed", color: PERSON_COLORS[2], removed: true };
  // Zed comes between Anna and Tom in the list, but removed people come after
  // everyone current.
  const people = { people: [anna, zed, tom] };
  const rows = (entries) => payerRows(people, new Map(entries));

  it("puts current people first in their order, then removed people, then Joint, then not set", () => {
    const scrambled = [["", 1], [JOINT, 5], ["z", 4], ["t", 2], ["a", 3]];
    expect(rows(scrambled)).toEqual([
      { payer: "a", amount: 3 }, { payer: "t", amount: 2 }, { payer: "z", amount: 4 },
      { payer: JOINT, amount: 5 }, { payer: "", amount: 1 },
    ]);
  });

  it("has a removed person only when they have spending", () => {
    expect(rows([["a", 3], ["t", 2]]).map((r) => r.payer)).toEqual(["a", "t"]);
    expect(rows([["a", 3], ["z", 4]]).map((r) => r.payer)).toEqual(["a", "z"]);
  });

  it("reads an id that matches nobody as not set, adding it to what has no payer", () => {
    expect(rows([["ghost", 40], ["", 5], ["a", 1]])).toEqual([{ payer: "a", amount: 1 }, { payer: "", amount: 45 }]);
    expect(rows([["ghost", 40]])).toEqual([{ payer: "", amount: 40 }]);
  });

  it("drops anyone with nothing", () => {
    expect(rows([["a", 0], ["t", 7], [JOINT, 0], ["", 0]])).toEqual([{ payer: "t", amount: 7 }]);
  });

  it("is empty when nothing was spent", () => {
    expect(rows([])).toEqual([]);
  });

  it("works on what spendingByPerson gives", () => {
    const d = base();
    expect(payerRows(d, spendingByPerson(month, "2026-10", TODAY, 1))).toEqual([
      { payer: "a", amount: 50 }, { payer: "t", amount: 30 }, { payer: JOINT, amount: 900 }, { payer: "", amount: 20 },
    ]);
  });
});

describe("anyoneNamed", () => {
  it("is true when a row says who paid, Joint included", () => {
    expect(anyoneNamed([{ payer: "a", amount: 1 }, { payer: "", amount: 2 }])).toBe(true);
    expect(anyoneNamed([{ payer: JOINT, amount: 1 }])).toBe(true);
  });

  it("is false when there is nothing, or only what nobody was marked for", () => {
    expect(anyoneNamed([])).toBe(false);
    expect(anyoneNamed([{ payer: "", amount: 5 }])).toBe(false);
  });
});

describe("the payer chosen last", () => {
  afterEach(() => vi.unstubAllGlobals());

  // vitest runs these in Node, which has no localStorage here.
  it("does not throw and gives nothing when there is no storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readLastPayer()).toEqual({});
    expect(() => rememberPayer({ paidBy: "a", paidWith: "visa" })).not.toThrow();
  });

  it("gives nothing when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    });
    expect(readLastPayer()).toEqual({});
    expect(() => rememberPayer({ paidBy: "a" })).not.toThrow();
  });

  const memory = (initial) => {
    const store = new Map(initial ? [[LAST_PAYER_KEY, initial]] : []);
    vi.stubGlobal("localStorage", { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) });
    return store;
  };

  it("remembers the last choice and reads it back", () => {
    memory();
    expect(readLastPayer()).toEqual({});
    rememberPayer({ paidBy: "a", paidWith: "visa" });
    expect(readLastPayer()).toEqual({ paidBy: "a", paidWith: "visa" });
    rememberPayer({ paidBy: JOINT });
    expect(readLastPayer()).toEqual({ paidBy: JOINT });
  });

  it("gives nothing when what is stored is not valid", () => {
    memory("{not json");
    expect(readLastPayer()).toEqual({});
    memory("null");
    expect(readLastPayer()).toEqual({});
    memory('"text"');
    expect(readLastPayer()).toEqual({});
  });
});
