import { describe, it, expect } from "vitest";
import { periodSpending, periodIncome, categoryAverage } from "./totals.js";

const D = (y, m, d) => new Date(y, m - 1, d);
const sumMap = (m) => [...m.values()].reduce((a, b) => a + b, 0);

const october = {
  expenses: [
    { id: "e1", name: "Groceries", amount: 120, category: "Food" },
    { id: "e2", name: "Mystery", amount: 10 },
  ],
  recurring: [
    { id: "r1", name: "Rent", amount: 2000, category: "Home", dayOfMonth: 1 },
    { id: "r2", name: "Netflix", amount: 45, category: "Fun", dayOfMonth: 20 },
  ],
  upcoming: [
    { id: "u1", name: "Dentist", amount: 300, category: "Health", dueDate: "2026-10-05", paid: true },
    { id: "u2", name: "Plumber", amount: 250, category: "Home", dueDate: "2026-10-03", paid: false },
    { id: "u3", name: "Insurance", amount: 600, category: "Car", dueDate: "2026-10-08", paid: false, autoPay: true },
    { id: "u4", name: "Gym", amount: 90, category: "Fun", dueDate: "2026-10-25", paid: false, autoPay: true },
  ],
};

describe("periodSpending", () => {
  const s = periodSpending(october, "2026-10", D(2026, 10, 9), 1);

  it("counts a paid Upcoming payment, in its category", () => {
    // The original bug: this 300 was in Total Spent but not under Health.
    expect(s.byCategory.get("Health")).toBe(300);
  });

  it("counts a self-paying bill once its date has passed, not before", () => {
    expect(s.byCategory.get("Car")).toBe(600);          // due 8 Oct, today 9 Oct
    expect(s.byCategory.has("Fun")).toBe(false); // Gym due 25th, Netflix 20th: nothing yet
  });

  it("does not count an unpaid manual payment, however overdue", () => {
    expect(s.upcoming).toBe(300 + 600);
  });

  it("counts recurring bills only once their day has passed", () => {
    expect(s.recurring).toBe(2000); // Rent on the 1st yes, Netflix on the 20th not yet
  });

  it("files uncategorised spending under Uncategorized", () => {
    expect(s.byCategory.get("Uncategorized")).toBe(10);
  });

  it("always has categories that add up to the total", () => {
    expect(sumMap(s.byCategory)).toBe(s.total);
    expect(s.total).toBe(s.expenses + s.recurring + s.upcoming);
    expect(s.total).toBe(120 + 10 + 2000 + 300 + 600);
  });

  it("counts every recurring bill once the period has closed", () => {
    const later = periodSpending(october, "2026-10", D(2026, 11, 15), 1);
    expect(later.recurring).toBe(2045);
    expect(later.byCategory.get("Fun")).toBe(45 + 90); // Netflix + Gym (self-paying, now past)
  });

  it("is zero for a missing period", () => {
    expect(periodSpending(undefined, "2026-10", D(2026, 10, 9), 1).total).toBe(0);
  });
});

describe("categoryAverage", () => {
  const data = {
    cutoffDay: 1,
    months: {
      "2026-08": { expenses: [{ amount: 100, category: "Food" }], recurring: [], upcoming: [
        { amount: 50, category: "Food", dueDate: "2026-08-10", paid: true }] },
      "2026-09": { expenses: [{ amount: 200, category: "Food" }], recurring: [], upcoming: [] },
      "2026-10": { expenses: [{ amount: 9999, category: "Food" }], recurring: [], upcoming: [] },
    },
  };

  it("averages only periods before the given one, paid bills included", () => {
    expect(categoryAverage(data, "Food", "2026-10", D(2026, 10, 9))).toBe((150 + 200) / 2);
  });

  it("is null when there is no history yet", () => {
    expect(categoryAverage(data, "Food", "2026-08", D(2026, 10, 9))).toBe(null);
  });
});

describe("periodIncome", () => {
  const month = {
    income: 8000,
    credits: [
      { amount: 500, dayOfMonth: 5 },        // repeating, 5th: received
      { amount: 200, dayOfMonth: 28 },       // repeating, 28th: not yet
      { amount: 150, date: "2026-10-09" },   // one-off today: received
      { amount: 75, date: "2026-10-20" },    // one-off later: pending
    ],
  };

  it("counts base income and the credits received so far", () => {
    const i = periodIncome(month, "2026-10", D(2026, 10, 9), 1);
    expect(i.total).toBe(8000 + 500 + 150);
    expect(i.pending).toBe(200 + 75);
  });

  it("counts every credit once the period has closed", () => {
    const i = periodIncome(month, "2026-10", D(2026, 11, 15), 1);
    expect(i.total).toBe(8000 + 500 + 200 + 150 + 75);
    expect(i.pending).toBe(0);
  });
});
