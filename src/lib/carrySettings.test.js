import { describe, it, expect } from "vitest";
import { carryNoticed, carryStartedFresh, carryTurnedOff, carryTurnedOn, showCarryNotice } from "./carrySettings.js";
import { carriedInto } from "./carryover.js";

// All synthetic. Paid on the 1st; the running period is November 2026.
const TODAY = new Date(2026, 10, 12, 12);
const m = (income, spent = 0) => ({
  income, expenses: spent ? [{ id: "e", name: "Food", amount: spent, category: "Food" }] : [], recurring: [], upcoming: [], credits: [],
});
const budget = (carry, extra = {}) => ({
  cutoffDay: 1, savingsGoal: { monthly: 100 }, carry,
  months: { "2026-09": m(1000, 800), "2026-10": m(1000, 600), "2026-11": m(1000) }, ...extra,
});

describe("carryTurnedOn", () => {
  it("starts with the period that just ended and drops any earlier start", () => {
    const d = budget({ on: false, from: "2026-08", noticed: false });
    expect(carryTurnedOn(d, TODAY)).toEqual({ on: true, from: "2026-10", noticed: true });
  });
  it("keeps earlier fresh starts", () => {
    const d = budget({ on: false, from: "2026-08", resets: ["2026-09"] });
    expect(carryTurnedOn(d, TODAY).resets).toEqual(["2026-09"]);
  });
  it("starts with the running period when no earlier period is on record", () => {
    const d = budget({ on: false, from: "2026-10" }, { months: { "2026-11": m(1000) } });
    expect(carryTurnedOn(d, TODAY).from).toBe("2026-11");
  });
  it("carries what the period that just ended left after its set-aside", () => {
    const off = budget({ on: false, from: "2026-08" });
    expect(carriedInto(off, "2026-11", TODAY)).toBe(0);
    const on = { ...off, carry: carryTurnedOn(off, TODAY) };
    expect(carriedInto(on, "2026-11", TODAY)).toBe(300);
  });
});

describe("carryTurnedOff", () => {
  it("switches off and marks the notice as seen, keeping the rest", () => {
    expect(carryTurnedOff(budget({ on: true, from: "2026-10", resets: ["2026-09"] })))
      .toEqual({ on: false, from: "2026-10", resets: ["2026-09"], noticed: true });
  });
});

describe("carryStartedFresh", () => {
  it("adds the running period and keeps the earlier ones", () => {
    const first = carryStartedFresh(budget({ on: true, from: "2026-08", resets: ["2026-09"] }), TODAY);
    expect(first.resets).toEqual(["2026-09", "2026-11"]);
  });
  it("twice in a row adds it once", () => {
    const d = budget({ on: true, from: "2026-08" });
    const once = carryStartedFresh(d, TODAY);
    expect(carryStartedFresh({ ...d, carry: once }, TODAY).resets).toEqual(["2026-11"]);
  });
  it("makes the running period start at 0", () => {
    const d = budget({ on: true, from: "2026-09" });
    expect(carriedInto(d, "2026-11", TODAY)).not.toBe(0);
    expect(carriedInto({ ...d, carry: carryStartedFresh(d, TODAY) }, "2026-11", TODAY)).toBe(0);
  });
});

describe("showCarryNotice", () => {
  const on = { on: true, from: "2026-10" };
  it("shows for money carried in, or for a goal that counted what the budget left over", () => {
    expect(showCarryNotice(budget(on), 300)).toBe(true);
    expect(showCarryNotice(budget(on), -50)).toBe(true);
    expect(showCarryNotice(budget(on, { goals: [{ id: "g", source: "budget" }] }), 0)).toBe(true);
  });
  it("stays away with nothing to say, once dismissed, or when off", () => {
    expect(showCarryNotice(budget(on, { goals: [{ id: "g", source: "account" }] }), 0)).toBe(false);
    expect(showCarryNotice(budget({ ...on, noticed: true }), 300)).toBe(false);
    expect(showCarryNotice(budget({ on: false, from: "2026-10" }), 300)).toBe(false);
  });
  it("is dismissed by carryNoticed", () => {
    expect(carryNoticed(budget(on)).noticed).toBe(true);
  });
});
