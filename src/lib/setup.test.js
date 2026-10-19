import { describe, it, expect } from "vitest";
import { applySetup, STARTER_CATEGORIES } from "./setup.js";

const fresh = {
  months: { "2026-10": { income: 0, expenses: [], recurring: [], upcoming: [], credits: [] } },
  currency: "USD", locale: "", cutoffDay: 1, savingsGoal: { monthly: 0 }, goals: [], accounts: [],
  categories: [{ name: "Uncategorized", color: "#9ca3af", icon: "·" }],
};
const TODAY = new Date(2026, 9, 11);

describe("applySetup", () => {
  const picked = STARTER_CATEGORIES.filter((c) => c.on);
  const out = applySetup(fresh, { currency: "PLN", locale: "pl-PL", cutoffDay: 25, income: "8500", setAside: 500.4, categories: picked }, TODAY);

  it("sets money, payday and the amount to set aside", () => {
    expect(out).toMatchObject({ currency: "PLN", locale: "pl-PL", cutoffDay: 25, savingsGoal: { monthly: 500 }, setupDone: true });
  });

  it("starts the current period from the chosen payday, with this month's income", () => {
    // Paid on the 25th: 11 October falls in the period that began 25 September.
    expect(Object.keys(out.months)).toEqual(["2026-09"]);
    expect(out.months["2026-09"].income).toBe(8500);
  });

  it("keeps Uncategorized and adds the chosen categories", () => {
    expect(out.categories.map((c) => c.name)).toEqual(["Uncategorized", ...picked.map((c) => c.name)]);
    expect(out.categories[1]).toEqual({ name: "Groceries", icon: "🛒", color: "#10b981" });
  });

  it("copes with nothing answered", () => {
    const bare = applySetup(fresh, {}, TODAY);
    expect(bare).toMatchObject({ currency: "USD", cutoffDay: 1, savingsGoal: { monthly: 0 } });
    expect(Object.keys(bare.months)).toEqual(["2026-10"]);
    expect(bare.categories.map((c) => c.name)).toEqual(["Uncategorized"]);
  });

  it("keeps the payday between the 1st and the 28th", () => {
    expect(applySetup(fresh, { cutoffDay: 31 }, TODAY).cutoffDay).toBe(28);
    expect(applySetup(fresh, { cutoffDay: 0 }, TODAY).cutoffDay).toBe(1);
  });

  it("offers each starter category once", () => {
    const names = STARTER_CATEGORIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("applySetup for pay every week or two", () => {
  const OCT_15 = new Date(2026, 9, 15, 12);

  it("a budget paid every two weeks starts on its fortnight", () => {
    const out = applySetup(fresh, { pay: "weeks:2", nextPayday: "2026-10-23", income: 1900, setAside: 185 }, OCT_15);
    expect(out.paySchedule).toEqual([{ kind: "weeks", every: 2, from: "2026-10-23" }]);
    expect(Object.keys(out.months)).toEqual(["2026-10-09"]);
    expect(out.months["2026-10-09"].income).toBe(1900);
    expect(out.cutoffDay).toBe(1);
    // The set-aside is entered per paycheck and kept per month.
    expect(out.savingsGoal.monthly).toBeCloseTo(185 * 26 / 12, 2);
  });

  it("monthly is as before", () => {
    const answers = { cutoffDay: 25, income: 4000, setAside: 300 };
    expect(applySetup(fresh, { ...answers, pay: "monthly" }, OCT_15)).toEqual(applySetup(fresh, answers, OCT_15));
    expect("paySchedule" in applySetup(fresh, answers, OCT_15)).toBe(false);
  });
});
