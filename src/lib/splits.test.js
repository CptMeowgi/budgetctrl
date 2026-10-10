import { describe, it, expect } from "vitest";
import { isSplit, splitParts, remainder, cleanSplit, renameInSplits } from "./splits.js";

describe("splitParts", () => {
  it("is the whole amount in its one category for an ordinary expense", () => {
    expect(splitParts({ category: "Food", amount: 200 })).toEqual([{ category: "Food", amount: 200 }]);
    expect(isSplit({ category: "Food", amount: 200 })).toBe(false);
  });

  it("is the splits for a split expense", () => {
    const e = { category: "Food", amount: 200, splits: [{ category: "Food", amount: 150 }, { category: "Home", amount: 50 }] };
    expect(splitParts(e)).toBe(e.splits);
    expect(isSplit(e)).toBe(true);
  });
});

describe("remainder", () => {
  it("is what is left to assign, in whole cents", () => {
    expect(remainder(200, [{ amount: 150 }, { amount: 30.1 }])).toBe(19.9);
    expect(remainder(0.3, [{ amount: 0.1 }, { amount: 0.2 }])).toBe(0);
  });
});

describe("cleanSplit", () => {
  it("keeps parts that add up, largest first, the largest as the headline category", () => {
    expect(cleanSplit(200, [{ category: "Home", amount: 50 }, { category: "Food", amount: "150" }])).toEqual({
      category: "Food", splits: [{ category: "Food", amount: 150 }, { category: "Home", amount: 50 }],
    });
  });

  it("merges parts in the same category and drops empty ones", () => {
    const r = cleanSplit(200, [{ category: "Food", amount: 100 }, { category: "Food", amount: 50 }, { category: "Home", amount: 50 }, { category: "Fun", amount: 0 }]);
    expect(r.splits).toEqual([{ category: "Food", amount: 150 }, { category: "Home", amount: 50 }]);
  });

  it("is an ordinary category once only one part is left", () => {
    expect(cleanSplit(200, [{ category: "Food", amount: 200 }, { category: "Home", amount: 0 }])).toEqual({ category: "Food", splits: undefined });
  });

  it("refuses parts that do not add up to the total", () => {
    expect(cleanSplit(200, [{ category: "Food", amount: 150 }, { category: "Home", amount: 40 }]).error).toBe("10.00 still to assign");
    expect(cleanSplit(200, [{ category: "Food", amount: 150 }, { category: "Home", amount: 60 }]).error).toBe("10.00 more than the total");
  });

  it("files a part with no category as Uncategorized", () => {
    expect(cleanSplit(30, [{ category: "", amount: 10 }, { category: "Food", amount: 20 }]).splits).toContainEqual({ category: "Uncategorized", amount: 10 });
  });
});

describe("renameInSplits", () => {
  const same = (n) => (x) => (x || "").toLowerCase() === n.toLowerCase();

  it("renames a part, merging it into a part that already has the new name", () => {
    const e = { amount: 200, category: "Food", splits: [{ category: "Food", amount: 120 }, { category: "Snacks", amount: 50 }, { category: "Home", amount: 30 }] };
    const out = renameInSplits(e, same("snacks"), "Food");
    expect(out.splits).toEqual([{ category: "Food", amount: 170 }, { category: "Home", amount: 30 }]);
  });

  it("becomes an ordinary expense when both parts end up in one category", () => {
    const e = { amount: 200, category: "Food", splits: [{ category: "Food", amount: 150 }, { category: "Snacks", amount: 50 }] };
    const out = renameInSplits(e, same("snacks"), "Food");
    expect(out.splits).toBeUndefined();
    expect(out.category).toBe("Food");
  });

  it("leaves untouched entries as they are", () => {
    const e = { amount: 10, category: "Food" };
    expect(renameInSplits(e, same("x"), "y")).toBe(e);
  });
});
