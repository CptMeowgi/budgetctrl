import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { hydrate, migrate } from "./model.js";
import { capAt } from "./lib/envelopes.js";
import { periodIncome, periodSpending } from "./lib/totals.js";

// A budget exactly as 0.4.2 saved it: the shape of that version's
// defaultData() with two months of use. 0.4.x kept it in the webview's
// localStorage under "budget-app-data"; 0.5 adopts it from there on first
// launch and runs it through migrate() and hydrate(), as here.
const SAVED_BY_0_4_2 = {
  months: {
    "2026-08": {
      income: 8500,
      expenses: [
        { id: "e1", name: "Biedronka", amount: 186.4, date: "2026-08-03", category: "Groceries" },
        { id: "e2", name: "Orlen", amount: 240, date: "2026-08-07", category: "Transport" },
      ],
      recurring: [
        { id: "r1", name: "Rent", amount: 2400, dayOfMonth: 1, category: "Home", templateId: "t1" },
        { id: "r2", name: "Netflix", amount: 49, dayOfMonth: 20, category: "Fun", autoPay: true, templateId: "t2" },
      ],
      upcoming: [{ id: "u1", name: "Dentist", amount: 300, dueDate: "2026-08-14", category: "Health", paid: true }],
      credits: [{ id: "c1", name: "Tax refund", amount: 420, date: "2026-08-06", category: "Refund" }],
    },
    "2026-09": {
      income: 8700,
      expenses: [{ id: "e3", name: "Lidl", amount: 154.2, date: "2026-09-16", category: "Groceries" }],
      recurring: [
        { id: "r3", name: "Rent", amount: 2400, dayOfMonth: 1, category: "Home", templateId: "t1" },
        { id: "r4", name: "Netflix", amount: 49, dayOfMonth: 20, category: "Fun", autoPay: true, templateId: "t2" },
      ],
      upcoming: [{ id: "u2", name: "Car insurance", amount: 860, dueDate: "2026-09-25", category: "Transport", paid: false }],
      credits: [{ id: "c2", name: "Allowance", amount: 300, dayOfMonth: 10, category: "Gift", templateId: "ct1" }],
    },
  },
  savingsGoal: { monthly: 500, target: 20000 },
  startingBalance: 3500,
  cutoffDay: 1,
  recurringTemplate: [
    { id: "t1", name: "Rent", amount: 2400, dayOfMonth: 1, category: "Home" },
    { id: "t2", name: "Netflix", amount: 49, dayOfMonth: 20, category: "Fun", autoPay: true },
  ],
  creditTemplate: [{ id: "ct1", name: "Allowance", amount: 300, dayOfMonth: 10, category: "Gift" }],
  categories: [
    { name: "Uncategorized", color: "#9ca3af", icon: "·" },
    { name: "Groceries", color: "#10b981", icon: "🍔", cap: 1200 },
    { name: "Transport", color: "#f59e0b", icon: "🚗" },
    { name: "Home", color: "#0066cc", icon: "🏠" },
    { name: "Fun", color: "#8b5cf6", icon: "🎮" },
    { name: "Health", color: "#ec4899", icon: "💊" },
  ],
  creditCategories: [
    { name: "Refund", color: "#10b981", icon: "↩" },
    { name: "Gift", color: "#ec4899", icon: "🎁" },
    { name: "Bonus", color: "#f59e0b", icon: "⭐" },
    { name: "Salary", color: "#0066cc", icon: "💼" },
    { name: "Other", color: "#9ca3af", icon: "·" },
  ],
  reminders: { enabled: true, leadDays: 5 },
};

describe("opening a budget saved by 0.4.2", () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 11, 12)); });
  afterAll(() => vi.useRealTimers());

  const open = () => hydrate(migrate(structuredClone(SAVED_BY_0_4_2)));

  it("keeps every month and every entry in it", () => {
    const d = open();
    for (const [key, before] of Object.entries(SAVED_BY_0_4_2.months)) {
      const after = d.months[key];
      expect(after.income).toBe(before.income);
      for (const list of ["expenses", "recurring", "upcoming", "credits"]) {
        expect(after[list].map((e) => [e.name, e.amount])).toEqual(before[list].map((e) => [e.name, e.amount]));
      }
    }
  });

  it("adds up to the same totals as before", () => {
    const d = open();
    const today = new Date(2026, 9, 11);
    // August: 426.40 of shopping and fuel, both bills, the paid dentist.
    expect(periodSpending(d.months["2026-08"], "2026-08", today, 1).total).toBeCloseTo(186.4 + 240 + 2400 + 49 + 300);
    expect(periodIncome(d.months["2026-08"], "2026-08", today, 1).total).toBe(8500 + 420);
    expect(periodIncome(d.months["2026-09"], "2026-09", today, 1).total).toBe(8700 + 300);
  });

  it("starts the current month from the templates, carrying the income", () => {
    const d = open();
    expect(d.months["2026-10"].income).toBe(8700);
    expect(d.months["2026-10"].recurring.map((r) => r.name)).toEqual(["Rent", "Netflix"]);
    expect(d.months["2026-10"].credits.map((c) => c.name)).toEqual(["Allowance"]);
  });

  it("keeps the recurring bills, credits, categories and category budgets", () => {
    const d = open();
    expect(d.recurringTemplate.map((r) => [r.name, r.amount, r.dayOfMonth, !!r.autoPay])).toEqual([["Rent", 2400, 1, false], ["Netflix", 49, 20, true]]);
    expect(d.creditTemplate.map((c) => [c.name, c.amount, c.dayOfMonth])).toEqual([["Allowance", 300, 10]]);
    expect(d.categories.map((c) => c.name)).toEqual(SAVED_BY_0_4_2.categories.map((c) => c.name));
    expect(capAt(d.categories.find((c) => c.name === "Groceries"), "2026-10")).toBe(1200);
    expect(d.creditCategories.map((c) => c.name)).toEqual(SAVED_BY_0_4_2.creditCategories.map((c) => c.name));
  });

  it("turns the savings target and starting balance into a goal, keeping what is set aside", () => {
    const d = open();
    expect(d.savingsGoal).toEqual({ monthly: 500 });
    expect(d.goals).toEqual([expect.objectContaining({ name: "Savings", target: 20000, startAmount: 3500, source: "budget" })]);
    expect(d).not.toHaveProperty("startingBalance");
  });

  it("keeps the settings, and the złoty formatting it always showed", () => {
    const d = open();
    expect(d.cutoffDay).toBe(1);
    expect(d.reminders).toEqual({ enabled: true, leadDays: 5 });
    expect(d.currency).toBe("PLN");
    expect(d.locale).toBe("pl-PL");
  });

  it("changes nothing when opened a second time", () => {
    const once = open();
    expect(hydrate(migrate(structuredClone(once)))).toEqual(once);
  });
});

describe("a budget missing parts of the current format", () => {
  it("keeps its months and settings, with the rest filled in", () => {
    const partial = { currency: "EUR", months: { "2026-10": { expenses: [{ id: "x1", name: "Bread", amount: 4.5, category: "Food", date: "2026-10-05" }] } } };
    const d = hydrate(migrate(partial));
    expect(d.currency).toBe("EUR");
    expect(d.months["2026-10"].expenses.map((e) => e.name)).toEqual(["Bread"]);
    expect(d.recurringTemplate).toEqual([]);
  });
});
