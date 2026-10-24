import { describe, it, expect } from "vitest";
import { bulkCategory, bulkDelete } from "./bulk.js";

const list = [
  { id: "a", name: "Lidl", amount: 20, category: "Uncategorized" },
  { id: "b", name: "Orlen", amount: 50, category: "Food" },
  { id: "c", name: "Market", amount: 30, category: "Food", splits: [{ category: "Food", amount: 20 }, { category: "Home", amount: 10 }] },
  { id: "d", name: "Cinema", amount: 15, category: "Fun" },
];

describe("bulkCategory", () => {
  it("files the selected entries under one category and leaves the rest alone", () => {
    const out = bulkCategory(list, new Set(["a", "b"]), "Groceries");
    expect(out.entries.map((e) => e.category)).toEqual(["Groceries", "Groceries", "Food", "Fun"]);
    expect(out.entries[3]).toBe(list[3]);
    expect([out.changed, out.skipped]).toEqual([2, 0]);
  });

  it("leaves a split payment as it is, and counts it", () => {
    const out = bulkCategory(list, new Set(["a", "c"]), "Groceries");
    expect(out.entries[2]).toBe(list[2]);
    expect([out.changed, out.skipped]).toEqual([1, 1]);
  });

  it("doesn't count an entry already in that category as changed", () => {
    expect(bulkCategory(list, new Set(["b"]), "Food").changed).toBe(0);
  });
});

describe("bulkDelete", () => {
  it("removes the selected entries", () => {
    const out = bulkDelete(list, new Set(["a", "d"]));
    expect(out.entries.map((e) => e.id)).toEqual(["b", "c"]);
    expect(out.removed).toBe(2);
  });

  it("ignores ids that aren't in the list", () => {
    expect(bulkDelete(list, new Set(["zz"])).removed).toBe(0);
  });
});
