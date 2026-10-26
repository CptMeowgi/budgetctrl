import { describe, it, expect } from "vitest";
import { checkUp, fixFinding } from "./checkup.js";

// Paid on the 1st; today is 20 Oct 2026, in "2026-10".
const TODAY = new Date(2026, 9, 20, 12);
const month = (o = {}) => ({ income: 3000, expenses: [], recurring: [], upcoming: [], credits: [], ...o });
const ex = (id, name, amount, date, category = "Food") => ({ id, name, amount, date, category });
const base = () => ({
  cutoffDay: 1,
  categories: [{ name: "Uncategorized" }, { name: "Food" }, { name: "Fun", cap: 100, rollover: { from: "2026-08" } }],
  creditCategories: [{ name: "Other" }, { name: "Refunds" }],
  recurringTemplate: [], creditTemplate: [],
  months: { "2026-08": month(), "2026-09": month(), "2026-10": month() },
});
const of = (findings, type) => findings.filter((f) => f.type === type);

describe("checkUp", () => {
  it("finds nothing wrong in a tidy budget", () => {
    expect(checkUp(base(), TODAY)).toEqual([]);
  });

  it("finds entries filed under a category that no longer exists", () => {
    const d = base();
    d.months["2026-09"].expenses = [ex("e1", "Cinema", 30, "2026-09-05", "Movies"), ex("e2", "Shop", 20, "2026-09-06")];
    d.months["2026-09"].credits = [{ id: "c1", name: "Refund", amount: 10, date: "2026-09-07", category: "Returns" }];
    d.recurringTemplate = [{ id: "t1", name: "Gym", amount: 40, dayOfMonth: 3, category: "Sport" }];
    const found = of(checkUp(d, TODAY), "missingCategory");
    expect(found.map((f) => [f.kind, f.entry.id, f.category])).toEqual([
      ["recurringTemplate", "t1", "Sport"], ["expense", "e1", "Movies"], ["credit", "c1", "Returns"],
    ]);
  });

  it("finds a split part filed under a missing category, and uncategorised entries", () => {
    const d = base();
    d.months["2026-10"].expenses = [
      { id: "s1", name: "Market", amount: 50, date: "2026-10-02", category: "Food", splits: [{ category: "Food", amount: 30 }, { category: "Garden", amount: 20 }] },
      ex("u1", "Something", 12, "2026-10-03", "Uncategorized"),
      { id: "u2", name: "No category", amount: 4, date: "2026-10-04" },
    ];
    const found = checkUp(d, TODAY);
    expect(of(found, "missingCategory").map((f) => [f.entry.id, f.category])).toEqual([["s1", "Garden"]]);
    expect(of(found, "uncategorized").map((f) => f.entry.id)).toEqual(["u1", "u2"]);
  });

  it("finds possible duplicates: the same date, amount and name, whatever the case", () => {
    const d = base();
    d.months["2026-10"].expenses = [
      ex("a", "Lidl", 23.4, "2026-10-05"), ex("b", "LIDL ", 23.4, "2026-10-05"), ex("c", "Lidl", 23.4, "2026-10-06"), ex("d", "Lidl", 23.5, "2026-10-05"),
    ];
    const found = of(checkUp(d, TODAY), "duplicate");
    expect(found.map((f) => [f.entry.id, f.of.id])).toEqual([["b", "a"]]);
  });

  it("finds one-off payments left unpaid in past periods, but not ones that pay themselves", () => {
    const d = base();
    d.months["2026-09"].upcoming = [
      { id: "p1", name: "Dentist", amount: 300, dueDate: "2026-09-20", paid: false },
      { id: "p2", name: "Insurance", amount: 90, dueDate: "2026-09-10", paid: true },
      { id: "p3", name: "Phone", amount: 30, dueDate: "2026-09-12", paid: false, autoPay: true },
    ];
    d.months["2026-10"].upcoming = [{ id: "p4", name: "Car", amount: 500, dueDate: "2026-10-28", paid: false }];
    expect(of(checkUp(d, TODAY), "unpaidPast").map((f) => [f.entry.id, f.periodKey])).toEqual([["p1", "2026-09"]]);
  });

  it("finds a rollover budget that arrives empty or worse", () => {
    const d = base();
    d.months["2026-08"].expenses = [ex("x1", "Concert", 180, "2026-08-10", "Fun")];
    d.months["2026-09"].expenses = [ex("x2", "Games", 60, "2026-09-10", "Fun")];
    // August left -80, September -(-80 + 100 - 60) ... carry into October: (100-180) + (100-60) = -40: not yet empty.
    expect(of(checkUp(d, TODAY), "rolloverDeficit")).toEqual([]);
    d.months["2026-09"].expenses = [ex("x2", "Games", 150, "2026-09-10", "Fun")];
    // Carry into October: (100-180) + (100-150) = -130, more than a whole budget of 100.
    const found = of(checkUp(d, TODAY), "rolloverDeficit");
    expect(found.map((f) => [f.kind, f.entry.name, f.carry, f.cap])).toEqual([["category", "Fun", -130, 100]]);
  });

  it("checks a bill's copy through its template, or on its own once the template has gone", () => {
    const d = base();
    d.recurringTemplate = [{ id: "t1", name: "Gym", amount: 40, dayOfMonth: 3, category: "Food" }];
    d.months["2026-10"].recurring = [
      { id: "r1", name: "Gym", amount: 40, dayOfMonth: 3, category: "Food", templateId: "t1" },
      { id: "r2", name: "Old club", amount: 25, dayOfMonth: 4, category: "Clubs", templateId: "gone" },
    ];
    expect(of(checkUp(d, TODAY), "missingCategory").map((f) => f.entry.id)).toEqual(["r2"]);
  });

  it("deletes a duplicate, and marks a past payment paid, changing nothing else", () => {
    const d = base();
    d.months["2026-10"].expenses = [ex("a", "Lidl", 23.4, "2026-10-05"), ex("b", "Lidl", 23.4, "2026-10-05")];
    d.months["2026-09"].upcoming = [{ id: "p1", name: "Dentist", amount: 300, dueDate: "2026-09-20", paid: false }];
    const [dup] = of(checkUp(d, TODAY), "duplicate");
    const once = fixFinding(d, dup);
    expect(once.months["2026-10"].expenses.map((e) => e.id)).toEqual(["a"]);
    expect(once.months["2026-09"]).toBe(d.months["2026-09"]);
    const [unpaid] = of(checkUp(d, TODAY), "unpaidPast");
    expect(fixFinding(d, unpaid).months["2026-09"].upcoming[0].paid).toBe(true);
    expect(d.months["2026-09"].upcoming[0].paid).toBe(false);
  });

  it("doesn't call a payment unpaid before its due date, wherever it's filed", () => {
    const d = base();
    d.months["2026-09"].upcoming = [{ id: "later", name: "Car service", amount: 900, dueDate: "2026-12-15", paid: false }];
    expect(of(checkUp(d, TODAY), "unpaidPast")).toEqual([]);
  });

  it("trusts a statement that shows two identical payments, but not a payment entered twice", () => {
    const d = base();
    d.months["2026-10"].expenses = [
      { ...ex("c1", "Coffee", 3.2, "2026-10-05"), imported: true }, { ...ex("c2", "Coffee", 3.2, "2026-10-05"), imported: true },
      { ...ex("s1", "Shell", 50, "2026-10-06"), imported: true }, ex("s2", "Shell", 50, "2026-10-06"),
    ];
    expect(of(checkUp(d, TODAY), "duplicate").map((f) => f.entry.id)).toEqual(["s2"]);
  });

  it("puts what matters most first", () => {
    const d = base();
    d.months["2026-10"].expenses = [ex("u", "Thing", 5, "2026-10-01", "Uncategorized"), ex("m", "Cinema", 30, "2026-10-05", "Movies")];
    d.months["2026-09"].upcoming = [{ id: "p", name: "Dentist", amount: 300, dueDate: "2026-09-20", paid: false }];
    expect(checkUp(d, TODAY).map((f) => f.type)).toEqual(["missingCategory", "unpaidPast", "uncategorized"]);
  });
});
