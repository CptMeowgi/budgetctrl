import { describe, it, expect } from "vitest";
import { ruleFor, suggestMatch, applyRule, upsertRule, orderedRules, moveRule, amountProblem } from "./rules.js";

// In the order they are checked: the first that fits wins.
const rules = [
  { id: "r2", match: "Orlen Stop Cafe", category: "Eating out", rename: "Orlen café" },
  { id: "r1", match: "orlen", category: "Transport" },
  { id: "r3", match: "BIEDRONKA*", category: "Food", rename: "Biedronka" },
  { id: "r4", match: "zwrot", category: "Refunds" },
];
const cats = { spendCategories: ["Food", "Transport", "Eating out", "Snacks"], creditCategories: ["Refunds"] };

describe("ruleFor", () => {
  it("matches without case, accents or a trailing star", () => {
    expect(ruleFor("BIEDRONKA 1234 WARSZAWA", rules).id).toBe("r3");
    expect(ruleFor("biedronka 77", rules).id).toBe("r3");
  });

  it("uses the first rule that fits, in your order", () => {
    expect(ruleFor("ORLEN STOP CAFE 551", rules).id).toBe("r2");
    expect(ruleFor("ORLEN 551", rules).id).toBe("r1");
    expect(ruleFor("ORLEN STOP CAFE 551", [rules[1], rules[0]]).id).toBe("r1");
  });

  it("finds nothing when nothing matches", () => {
    expect(ruleFor("Netflix", rules)).toBe(null);
    expect(ruleFor("anything", [{ id: "x", match: "  " }])).toBe(null);
  });

  it("skips a rule whose text the description must not contain", () => {
    const list = [{ id: "a", match: "orlen", exclude: "stop cafe", category: "Transport" }, { id: "b", match: "orlen", category: "Eating out" }];
    expect(ruleFor("ORLEN 551 WARSZAWA", list).id).toBe("a");
    expect(ruleFor("ORLEN STOP CAFÉ 551", list).id).toBe("b");
  });

  it("checks the amount, whichever way the money went", () => {
    const list = [
      { id: "small", match: "orlen", amount: { op: "under", value: 50 }, category: "Snacks" },
      { id: "fuel", match: "orlen", category: "Transport" },
    ];
    expect(ruleFor("ORLEN 551", list, -23.5).id).toBe("small");
    expect(ruleFor("ORLEN 551", list, -180).id).toBe("fuel");
    expect(ruleFor("ORLEN 551", list, -50).id).toBe("fuel");
    expect(ruleFor("ORLEN 551", list).id).toBe("fuel");
    expect(ruleFor("X", [{ id: "big", match: "x", amount: { op: "over", value: 1000 } }], 1000.01).id).toBe("big");
    expect(ruleFor("X", [{ id: "eq", match: "x", amount: { op: "equal", value: 49.99 } }], -49.99).id).toBe("eq");
    expect(ruleFor("X", [{ id: "eq", match: "x", amount: { op: "equal", value: 49.99 } }], -50)).toBe(null);
  });

  it("a rule with only an amount applies to every description", () => {
    const list = [{ id: "big", match: "", amount: { op: "over", value: 1000 }, category: "Transport" }];
    expect(ruleFor("ANYTHING AT ALL", list, -1500).id).toBe("big");
    expect(ruleFor("ANYTHING AT ALL", list, -15)).toBe(null);
  });

  it("reads the figure as typed, with a decimal comma", () => {
    expect(ruleFor("X", [{ id: "eq", match: "x", amount: { op: "equal", value: "49,99" } }], -49.99).id).toBe("eq");
  });

  it("reads figures as amounts are written anywhere else: thousands, currency, a minus sign", () => {
    const under = (value) => [{ id: "u", match: "x", amount: { op: "under", value } }];
    expect(ruleFor("X", under("1.234,56"), -1000).id).toBe("u");
    expect(ruleFor("X", under("50 zł"), -60)).toBe(null);
    expect(ruleFor("X", under("50 zł"), -40).id).toBe("u");
    expect(ruleFor("X", under("-50"), -40).id).toBe("u");
    expect(ruleFor("X", [{ id: "o", match: "x", amount: { op: "over", value: "-50" } }], -10)).toBe(null);
  });

  it("a figure that isn't a number makes the rule not apply, rather than apply to everything", () => {
    const list = [{ id: "bad", match: "orlen", amount: { op: "under", value: "fifty" } }];
    expect(ruleFor("ORLEN", list, -60)).toBe(null);
    expect(amountProblem(list[0])).toBe(true);
    expect(amountProblem({ match: "orlen", amount: { op: "under", value: "50" } })).toBe(false);
    expect(amountProblem({ match: "orlen" })).toBe(false);
  });

  it("ignores an amount condition with no figure", () => {
    expect(ruleFor("ORLEN", [{ id: "a", match: "orlen", amount: { op: "under", value: null } }], -10).id).toBe("a");
  });
});

describe("suggestMatch", () => {
  it("skips the words that only say how it was paid", () => {
    expect(suggestMatch("ZAKUP PRZY UŻYCIU KARTY BIEDRONKA 1234")).toBe("biedronka");
    expect(suggestMatch("BIEDRONKA 1234 WARSZAWA")).toBe("biedronka");
    expect(suggestMatch("Płatność kartą ŻABKA Z1234")).toBe("zabka");
    expect(suggestMatch("Netflix.com")).toBe("netflix");
  });
});

describe("applyRule", () => {
  it("sets the category and the clean name, keeping the bank's wording in the note", () => {
    const row = applyRule({ action: "expense", name: "BIEDRONKA 1234 WARSZAWA", amount: -50 }, rules, cats);
    expect(row).toMatchObject({ category: "Food", name: "Biedronka", note: "BIEDRONKA 1234 WARSZAWA", rule: "r3" });
  });

  it("keeps an existing note", () => {
    expect(applyRule({ action: "expense", name: "BIEDRONKA 1", note: "receipt 7", amount: -5 }, rules, cats).note).toBe("receipt 7");
  });

  it("does not file money in under a spending category", () => {
    const row = applyRule({ action: "credit", name: "ORLEN refund", amount: 20, category: "Other" }, rules, cats);
    expect(row.category).toBe("Other");
    expect(applyRule({ action: "credit", name: "ZWROT ZA ZAMOWIENIE", amount: 20 }, rules, cats).category).toBe("Refunds");
  });

  it("leaves skipped rows and payments that settle a bill alone", () => {
    const skip = { action: "skip", name: "BIEDRONKA", amount: -5 };
    expect(applyRule(skip, rules, cats)).toBe(skip);
    const paid = { action: "markPaid", name: "ORLEN", amount: -5 };
    expect(applyRule(paid, rules, cats)).toBe(paid);
  });

  it("files by the row's amount: ORLEN under 50 is a snack, otherwise fuel", () => {
    const list = [
      { id: "small", match: "orlen", amount: { op: "under", value: 50 }, category: "Snacks" },
      { id: "fuel", match: "orlen", category: "Transport" },
    ];
    expect(applyRule({ action: "expense", name: "ORLEN 551", amount: -12 }, list, cats).category).toBe("Snacks");
    expect(applyRule({ action: "expense", name: "ORLEN 551", amount: -250 }, list, cats).category).toBe("Transport");
  });
});

describe("upsertRule", () => {
  let n = 0;
  const id = () => `new${++n}`;

  it("adds a rule", () => {
    expect(upsertRule(rules, { match: "netflix", category: "Fun" }, id).at(-1)).toEqual({ id: "new1", match: "netflix", category: "Fun" });
  });

  it("updates the rule that already looks for the same text", () => {
    const out = upsertRule(rules, { match: "ORLEN", category: "Car" }, id);
    expect(out).toHaveLength(rules.length);
    expect(out.find((r) => r.id === "r1").category).toBe("Car");
  });

  it("ignores a rule with nothing to look for", () => {
    expect(upsertRule(rules, { match: " * ", category: "Food" }, id)).toBe(rules);
  });

  it("puts a new rule above a broader one it would otherwise lose to", () => {
    const out = upsertRule([{ id: "o", match: "orlen", category: "Transport" }], { match: "orlen stop", category: "Eating out" }, id);
    expect(out.map((r) => r.match)).toEqual(["orlen stop", "orlen"]);
  });

  it("puts a new rule above one that only checks the amount", () => {
    const list = [{ id: "a", match: "", amount: { op: "over", value: 100 }, category: "Transport" }];
    expect(upsertRule(list, { match: "biedronka", category: "Food" }, id).map((r) => r.match)).toEqual(["biedronka", ""]);
  });

  it("never overwrites a rule with conditions; it adds a plain one after it", () => {
    const list = [{ id: "small", match: "orlen", amount: { op: "under", value: 50 }, category: "Snacks" }];
    const out = upsertRule(list, { match: "orlen", category: "Transport" }, id);
    expect(out.map((r) => r.id)).toEqual(["small", expect.stringMatching(/^new/)]);
    expect(out[0].category).toBe("Snacks");
  });
});

describe("orderedRules", () => {
  it("reads rules made when the longest text won in that order, so each still files as before", () => {
    const old = { importRules: [{ id: "r1", match: "orlen" }, { id: "b", match: "biedronka" }, { id: "r2", match: "Orlen Stop Cafe" }, { id: "z", match: "zabka" }] };
    expect(orderedRules(old).map((r) => r.id)).toEqual(["r2", "b", "r1", "z"]);
    expect(ruleFor("ORLEN STOP CAFE 551", orderedRules(old)).id).toBe("r2");
    expect(old.importRules[0].id).toBe("r1");
  });

  it("once saved in order, the order is yours", () => {
    const mine = { importRulesOrdered: true, importRules: [{ id: "r1", match: "orlen" }, { id: "r2", match: "orlen stop cafe" }] };
    expect(orderedRules(mine)).toBe(mine.importRules);
  });

  it("a budget without rules has none", () => {
    expect(orderedRules({ months: {} })).toEqual([]);
  });
});

describe("moveRule", () => {
  it("moves a rule up or down, and stops at the ends", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(moveRule(list, "c", -1).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(moveRule(list, "a", 1).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(moveRule(list, "a", -1)).toBe(list);
    expect(moveRule(list, "c", 1)).toBe(list);
  });
});
