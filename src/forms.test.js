import { describe, it, expect, vi, afterEach } from "vitest";
import { payerField, payerToSave, startingPayer } from "./forms.js";
import { JOINT, LAST_PAYER_KEY, readLastPayer } from "./lib/people.js";

const budget = (overrides) => ({
  people: [{ id: "a", name: "Anna" }, { id: "t", name: "Tom" }],
  accounts: [
    { id: "visa", name: "Visa", owner: "a" },
    { id: "debit", name: "Tom's debit", owner: "t" },
    { id: "savings", name: "Savings" },
    { id: "old", name: "Old card", owner: "a", closed: true },
  ],
  ...overrides,
});
const SHARED = budget();
const ALONE = budget({ people: [{ id: "a", name: "Anna" }] });

// vitest runs these in Node, which has no localStorage here.
const memory = (initial) => {
  const store = new Map(initial ? [[LAST_PAYER_KEY, JSON.stringify(initial)]] : []);
  const setItem = vi.fn((k, v) => store.set(k, String(v)));
  vi.stubGlobal("localStorage", { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem });
  return { store, setItem };
};

afterEach(() => vi.unstubAllGlobals());

describe("payerToSave", () => {
  it("gives nothing when the budget isn't shared, so values from a shared time survive", () => {
    const { setItem } = memory();
    expect(payerToSave(ALONE, { paidBy: "a", paidWith: "visa" }, true)).toEqual({});
    expect(payerToSave(ALONE, undefined, false)).toEqual({});
    expect(setItem).not.toHaveBeenCalled();
  });

  it("with nothing chosen gives both keys as undefined, so Not set really clears", () => {
    memory();
    const out = payerToSave(SHARED, {}, false);
    expect(Object.keys(out).sort()).toEqual(["paidBy", "paidWith"]);
    expect(out.paidBy).toBeUndefined();
    expect(out.paidWith).toBeUndefined();
    // Nothing at all chosen (no payer object) clears too.
    expect(Object.keys(payerToSave(SHARED, undefined, false)).sort()).toEqual(["paidBy", "paidWith"]);
  });

  it("gives what was chosen, and leaves out what doesn't fit", () => {
    memory();
    expect(payerToSave(SHARED, { paidBy: "a", paidWith: "visa" }, false)).toEqual({ paidBy: "a", paidWith: "visa" });
    expect(payerToSave(SHARED, { paidBy: JOINT, paidWith: "savings" }, false)).toEqual({ paidBy: JOINT, paidWith: "savings" });
    // Tom's account can't be on Anna's entry; a person who doesn't exist is dropped.
    const out = payerToSave(SHARED, { paidBy: "a", paidWith: "debit" }, false);
    expect(out.paidBy).toBe("a");
    expect(out.paidWith).toBeUndefined();
    expect(payerToSave(SHARED, { paidBy: "nobody" }, false).paidBy).toBeUndefined();
  });

  it("remembers the choice when adding, and not when editing", () => {
    const { setItem } = memory();
    payerToSave(SHARED, { paidBy: "a", paidWith: "visa" }, false);
    expect(setItem).not.toHaveBeenCalled();
    payerToSave(SHARED, { paidBy: "a", paidWith: "visa" }, true);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(readLastPayer()).toEqual({ paidBy: "a", paidWith: "visa" });
  });

  it("remembers what was kept, not what the form held", () => {
    memory();
    payerToSave(SHARED, { paidBy: "a", paidWith: "debit" }, true);
    expect(readLastPayer()).toEqual({ paidBy: "a" });
  });

  it("an add with nothing chosen remembers nothing, so the next entry starts blank", () => {
    memory({ paidBy: "a", paidWith: "visa" });
    payerToSave(SHARED, {}, true);
    expect(readLastPayer()).toEqual({});
  });
});

describe("startingPayer, editing", () => {
  it("starts from the entry's own payer", () => {
    memory({ paidBy: "t" });
    expect(startingPayer(SHARED, { paidBy: "a", paidWith: "visa" })).toEqual({ paidBy: "a", paidWith: "visa" });
  });

  it("an entry with no payer starts blank, not on the last payer", () => {
    memory({ paidBy: "a", paidWith: "visa" });
    expect(startingPayer(SHARED, { name: "Old entry" })).toEqual({});
  });

  it("keeps a removed person and a closed account, so saving an old entry doesn't wipe them", () => {
    memory();
    const data = budget({ people: [{ id: "a", name: "Anna" }, { id: "t", name: "Tom" }, { id: "s", name: "Sam", removed: true }] });
    expect(startingPayer(data, { paidBy: "s" })).toEqual({ paidBy: "s" });
    expect(startingPayer(data, { paidBy: "a", paidWith: "old" })).toEqual({ paidBy: "a", paidWith: "old" });
  });

  it("drops an id that no longer exists", () => {
    memory();
    expect(startingPayer(SHARED, { paidBy: "gone", paidWith: "gone-too" })).toEqual({});
  });
});

describe("startingPayer, a new entry", () => {
  it("starts from the last payer chosen", () => {
    memory({ paidBy: "a", paidWith: "visa" });
    expect(startingPayer(SHARED, null)).toEqual({ paidBy: "a", paidWith: "visa" });
    expect(startingPayer(SHARED, undefined)).toEqual({ paidBy: "a", paidWith: "visa" });
  });

  it("starts blank when nothing was chosen yet", () => {
    memory();
    expect(startingPayer(SHARED, null)).toEqual({});
  });

  it("drops a person or account that no longer exists", () => {
    memory({ paidBy: "gone", paidWith: "gone-too" });
    expect(startingPayer(SHARED, null)).toEqual({});
  });

  it("never starts on someone who has been removed", () => {
    memory({ paidBy: "t", paidWith: "savings" });
    const data = budget({ people: [{ id: "a", name: "Anna" }, { id: "t", name: "Tom", removed: true }, { id: "s", name: "Sam" }] });
    const out = startingPayer(data, null);
    expect(out.paidBy).toBeUndefined();
    // An account that is still open and nobody's in particular is fine to keep.
    expect(out.paidWith).toBe("savings");
  });

  it("never starts on a closed account", () => {
    memory({ paidBy: "a", paidWith: "old" });
    expect(startingPayer(SHARED, null)).toEqual({ paidBy: "a" });
  });

  it("keeps Joint", () => {
    memory({ paidBy: JOINT, paidWith: "savings" });
    expect(startingPayer(SHARED, null)).toEqual({ paidBy: JOINT, paidWith: "savings" });
  });
});

describe("payerField", () => {
  it("is nothing when the budget isn't shared", () => {
    memory({ paidBy: "a" });
    expect(payerField(ALONE, null)).toEqual([]);
  });

  it("is one payer field, starting where startingPayer says", () => {
    memory({ paidBy: "a", paidWith: "visa" });
    const [field, ...rest] = payerField(SHARED, null);
    expect(rest).toEqual([]);
    expect(field).toMatchObject({ key: "payer", type: "payer", data: SHARED, defaultValue: { paidBy: "a", paidWith: "visa" } });
    expect(field.incoming).toBeFalsy();
  });

  it("passes on that it is for money coming in, and starts from the entry when editing", () => {
    memory({ paidBy: "a" });
    const [field] = payerField(SHARED, { paidBy: "t" }, { incoming: true });
    expect(field.incoming).toBe(true);
    expect(field.defaultValue).toEqual({ paidBy: "t" });
  });
});
