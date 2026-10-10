import { describe, it, expect } from "vitest";
import { ruleFor, suggestMatch, applyRule, upsertRule } from "./rules.js";

const rules = [
  { id: "r1", match: "orlen", category: "Transport" },
  { id: "r2", match: "Orlen Stop Cafe", category: "Eating out", rename: "Orlen café" },
  { id: "r3", match: "BIEDRONKA*", category: "Food", rename: "Biedronka" },
  { id: "r4", match: "zwrot", category: "Refunds" },
];
const cats = { spendCategories: ["Food", "Transport", "Eating out"], creditCategories: ["Refunds"] };

describe("ruleFor", () => {
  it("matches without case, accents or a trailing star", () => {
    expect(ruleFor("BIEDRONKA 1234 WARSZAWA", rules).id).toBe("r3");
    expect(ruleFor("biedronka 77", rules).id).toBe("r3");
  });

  it("prefers the most specific rule", () => {
    expect(ruleFor("ORLEN STOP CAFE 551", rules).id).toBe("r2");
    expect(ruleFor("ORLEN 551", rules).id).toBe("r1");
  });

  it("finds nothing when nothing matches", () => {
    expect(ruleFor("Netflix", rules)).toBe(null);
    expect(ruleFor("anything", [{ id: "x", match: "  " }])).toBe(null);
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
});
