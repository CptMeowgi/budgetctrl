import { describe, it, expect } from "vitest";
import { renameCategory, deleteCategory, restyleCategory, countUsage, isFallback } from "./categories.js";

// A document with spending and income categories referenced from two periods
// and both templates - the five places a category name actually lives.
function fixture() {
  return {
    categories: [
      { name: "Uncategorized", color: "#9ca3af", icon: "·" },
      { name: "Food", color: "#10b981", icon: "F", cap: 1200 },
      { name: "Fun", color: "#f59e0b", icon: "J" },
      { name: "Home", color: "#8b5cf6", icon: "H", cap: 2500 },
    ],
    creditCategories: [
      { name: "Other", color: "#9ca3af", icon: "·" },
      { name: "Gift", color: "#ec4899", icon: "G" },
      { name: "Salary", color: "#10b981", icon: "S" },
    ],
    months: {
      "2026-09": {
        expenses: [
          { id: "e1", name: "Groceries", category: "Food" },
          { id: "e2", name: "Cinema", category: "Fun" },
        ],
        recurring: [{ id: "r1", name: "Rent", category: "Home" }],
        upcoming: [{ id: "u1", name: "Dinner out", category: "Food" }],
        credits: [{ id: "c1", name: "Birthday", category: "Gift" }],
      },
      "2026-10": {
        expenses: [{ id: "e3", name: "Bakery", category: "food" }], // legacy lowercase
        recurring: [],
        upcoming: [],
        credits: [{ id: "c2", name: "Pay", category: "Salary" }],
      },
    },
    recurringTemplate: [{ id: "t1", name: "Meal kit", category: "Food" }],
    creditTemplate: [{ id: "ct1", name: "Allowance", category: "Gift" }],
  };
}

const cats = (d, k = "categories") => d[k].map((c) => c.name);
const allSpend = (d) => [
  ...Object.values(d.months).flatMap((m) => [...m.expenses, ...m.recurring, ...m.upcoming]),
  ...d.recurringTemplate,
];

describe("renameCategory", () => {
  it("renames the category and keeps its colour, icon and cap", () => {
    const out = renameCategory(fixture(), "spend", "Food", "Groceries & food");
    const c = out.categories.find((x) => x.name === "Groceries & food");
    expect(c).toMatchObject({ color: "#10b981", icon: "F", cap: 1200 });
    expect(cats(out)).not.toContain("Food");
  });

  it("rewrites every entry in every period, and the recurring template", () => {
    const out = renameCategory(fixture(), "spend", "Food", "Eating");
    const eating = allSpend(out).filter((e) => e.category === "Eating").map((e) => e.id).sort();
    // e1, e3 (case-insensitive legacy match), u1 and template t1
    expect(eating).toEqual(["e1", "e3", "t1", "u1"]);
    expect(allSpend(out).some((e) => e.category === "Food" || e.category === "food")).toBe(false);
  });

  it("leaves other categories' entries alone", () => {
    const out = renameCategory(fixture(), "spend", "Food", "Eating");
    expect(out.months["2026-09"].expenses.find((e) => e.id === "e2").category).toBe("Fun");
    expect(out.months["2026-09"].recurring[0].category).toBe("Home");
  });

  it("handles a case-only rename", () => {
    const out = renameCategory(fixture(), "spend", "Fun", "FUN");
    expect(cats(out)).toContain("FUN");
    expect(cats(out)).not.toContain("Fun");
    expect(out.months["2026-09"].expenses.find((e) => e.id === "e2").category).toBe("FUN");
  });

  it("merges into an existing category when renamed onto it", () => {
    const out = renameCategory(fixture(), "spend", "Fun", "home");
    expect(cats(out)).not.toContain("Fun");
    const home = out.categories.filter((c) => c.name === "Home");
    expect(home).toHaveLength(1);
    expect(home[0]).toMatchObject({ color: "#8b5cf6", cap: 2500 }); // target keeps its style
    expect(out.months["2026-09"].expenses.find((e) => e.id === "e2").category).toBe("Home");
  });

  it("carries a cap across a merge when only the source had one", () => {
    const out = renameCategory(fixture(), "spend", "Food", "Fun");
    expect(out.categories.find((c) => c.name === "Fun").cap).toBe(1200);
  });

  it("carries the budget's history and rollover along with the cap", () => {
    const d = fixture();
    d.categories = d.categories.map((c) => (c.name === "Food"
      ? { ...c, capHistory: [{ from: "2026-01", cap: 1200 }], rollover: { from: "2026-05" } } : c));
    const fun = renameCategory(d, "spend", "Food", "Fun").categories.find((c) => c.name === "Fun");
    expect(fun.capHistory).toEqual([{ from: "2026-01", cap: 1200 }]);
    expect(fun.rollover).toEqual({ from: "2026-05" });
  });

  it("refuses to rename the fallback, an empty name, or a missing category", () => {
    expect(() => renameCategory(fixture(), "spend", "Uncategorized", "X")).toThrow();
    expect(() => renameCategory(fixture(), "spend", "Food", "   ")).toThrow();
    expect(() => renameCategory(fixture(), "spend", "Nope", "X")).toThrow();
  });

  it("does not mutate its input", () => {
    const d = fixture();
    const snapshot = JSON.stringify(d);
    renameCategory(d, "spend", "Food", "Eating");
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});

describe("deleteCategory", () => {
  it("moves entries to the fallback by default", () => {
    const out = deleteCategory(fixture(), "spend", "Food");
    expect(cats(out)).not.toContain("Food");
    const moved = allSpend(out).filter((e) => e.category === "Uncategorized").map((e) => e.id).sort();
    expect(moved).toEqual(["e1", "e3", "t1", "u1"]);
  });

  it("moves entries into a chosen category instead", () => {
    const out = deleteCategory(fixture(), "spend", "Fun", "Home");
    expect(out.months["2026-09"].expenses.find((e) => e.id === "e2").category).toBe("Home");
  });

  it("recreates the fallback if it is missing rather than orphaning entries", () => {
    const d = fixture();
    d.categories = d.categories.filter((c) => c.name !== "Uncategorized");
    const out = deleteCategory(d, "spend", "Fun");
    expect(cats(out)).toContain("Uncategorized");
  });

  it("refuses to delete the fallback, or to move entries into the deleted category", () => {
    expect(() => deleteCategory(fixture(), "spend", "Uncategorized")).toThrow();
    expect(() => deleteCategory(fixture(), "spend", "Fun", "fun")).toThrow();
  });
});

describe("credit categories", () => {
  it("rename touches credits and the credit template, never spending entries", () => {
    const out = renameCategory(fixture(), "credit", "Gift", "Gifts");
    expect(out.months["2026-09"].credits[0].category).toBe("Gifts");
    expect(out.creditTemplate[0].category).toBe("Gifts");
    expect(cats(out)).toEqual(cats(fixture())); // spending list untouched
  });

  it("delete falls back to Other", () => {
    const out = deleteCategory(fixture(), "credit", "Gift");
    expect(out.months["2026-09"].credits[0].category).toBe("Other");
    expect(isFallback("credit", "other")).toBe(true);
  });
});

describe("restyleCategory and countUsage", () => {
  it("changes colour and icon without touching entries", () => {
    const out = restyleCategory(fixture(), "spend", "Fun", { color: "#000000", icon: "Z" });
    expect(out.categories.find((c) => c.name === "Fun")).toMatchObject({ color: "#000000", icon: "Z" });
    expect(out.months).toEqual(fixture().months);
  });

  it("counts period entries and template items separately", () => {
    expect(countUsage(fixture(), "spend", "Food")).toEqual({ entries: 3, templates: 1 });
    expect(countUsage(fixture(), "credit", "Gift")).toEqual({ entries: 1, templates: 1 });
    expect(countUsage(fixture(), "spend", "Fun")).toEqual({ entries: 1, templates: 0 });
  });
});
