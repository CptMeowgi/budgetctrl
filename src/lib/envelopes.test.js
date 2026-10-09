import { describe, it, expect } from "vitest";
import { capAt, withCap, withRollover, startFresh, carryInto, envelope } from "./envelopes.js";

const D = (y, m, d) => new Date(y, m - 1, d);
const TODAY = D(2026, 10, 9);
const spend = (amount, category = "Gifts") => ({ amount, category, name: "x" });
const month = (...expenses) => ({ income: 0, expenses, recurring: [], upcoming: [], credits: [] });

describe("capAt", () => {
  it("uses the one cap for every period when no history was kept", () => {
    expect(capAt({ cap: 200 }, "2020-01")).toBe(200);
    expect(capAt({}, "2026-10")).toBe(null);
  });

  it("treats a budget of zero as no budget", () => {
    expect(capAt({ cap: 0 }, "2026-10")).toBe(null);
    expect(withCap({ name: "x", cap: 0 }, 300, "2026-10").capHistory).toEqual([{ from: "2026-10", cap: 300 }]);
  });

  it("uses the budget that applied in that period", () => {
    const c = { cap: 300, capHistory: [{ from: "2026-08", cap: 200 }, { from: "2026-10", cap: 300 }] };
    expect(capAt(c, "2026-07")).toBe(null);
    expect(capAt(c, "2026-08")).toBe(200);
    expect(capAt(c, "2026-09")).toBe(200);
    expect(capAt(c, "2026-10")).toBe(300);
  });
});

describe("withCap", () => {
  it("keeps the old budget for earlier periods on the first change", () => {
    const c = withCap({ name: "Gifts", cap: 200 }, 300, "2026-10");
    expect(c.cap).toBe(300);
    expect(capAt(c, "2026-09")).toBe(200);
    expect(capAt(c, "2026-10")).toBe(300);
  });

  it("replaces a change made earlier in the same period", () => {
    const c = withCap(withCap({ name: "Gifts", cap: 200 }, 300, "2026-10"), 350, "2026-10");
    expect(c.capHistory.filter((h) => h.from === "2026-10")).toHaveLength(1);
    expect(capAt(c, "2026-10")).toBe(350);
  });

  it("removing the budget also stops rollover", () => {
    const c = withCap({ name: "Gifts", cap: 200, rollover: { from: "2026-08" } }, null, "2026-10");
    expect(c.cap).toBeUndefined();
    expect(c.rollover).toBeUndefined();
    expect(capAt(c, "2026-09")).toBe(200);
    expect(capAt(c, "2026-10")).toBe(null);
  });
});

describe("withRollover / startFresh", () => {
  it("starts counting from the period it is switched on", () => {
    expect(withRollover({ cap: 100 }, true, "2026-10").rollover).toEqual({ from: "2026-10" });
  });

  it("keeps the balance built up when left on", () => {
    const c = { cap: 100, rollover: { from: "2026-05" } };
    expect(withRollover(c, true, "2026-10")).toBe(c);
  });

  it("cannot roll over without a budget", () => {
    expect(withRollover({ name: "x" }, true, "2026-10").rollover).toBeUndefined();
  });

  it("start fresh resets the starting point", () => {
    expect(startFresh({ cap: 100, rollover: { from: "2026-05" } }, "2026-10").rollover).toEqual({ from: "2026-10" });
  });
});

describe("carryInto", () => {
  const gifts = { name: "Gifts", cap: 200, rollover: { from: "2026-07" } };
  const data = {
    cutoffDay: 1,
    months: {
      "2026-06": month(spend(10)),          // before rollover began: ignored
      "2026-07": month(spend(150)),         // +50
      "2026-08": month(spend(80), spend(999, "Food")), // +120, other categories ignored
      "2026-09": month(spend(300)),         // -100
      "2026-10": month(spend(40)),          // the period itself: not carried into itself
    },
  };

  it("adds up each earlier period's leftover, overspending included", () => {
    expect(carryInto(data, gifts, "2026-10", TODAY)).toBe(50 + 120 - 100);
  });

  it("carries nothing into the period rollover began", () => {
    expect(carryInto(data, gifts, "2026-07", TODAY)).toBe(0);
  });

  it("is zero for a category that does not roll over", () => {
    expect(carryInto(data, { name: "Gifts", cap: 200 }, "2026-10", TODAY)).toBe(0);
  });

  it("uses the budget each period actually had", () => {
    const changed = { ...withCap(gifts, 400, "2026-09"), rollover: gifts.rollover };
    // July 200-150, August 200-80, September 400-300
    expect(carryInto(data, changed, "2026-10", TODAY)).toBe(50 + 120 + 100);
  });

  it("does not accrue budget for a month the app has no record of", () => {
    const gap = { ...data, months: { ...data.months } };
    delete gap.months["2026-08"];
    expect(carryInto(gap, gifts, "2026-10", TODAY)).toBe(50 - 100);
  });

  it("counts a paid Upcoming payment, like every other total", () => {
    const withPaid = { ...data, months: { ...data.months, "2026-07": {
      ...month(spend(150)),
      upcoming: [{ amount: 50, category: "Gifts", dueDate: "2026-07-20", paid: true }],
    } } };
    expect(carryInto(withPaid, gifts, "2026-10", TODAY)).toBe(0 + 120 - 100);
  });

  it("does not drift with floating-point cents", () => {
    const cents = { cutoffDay: 1, months: { "2026-08": month(spend(0.1), spend(0.2)), "2026-09": month() } };
    expect(carryInto(cents, { name: "Gifts", cap: 1, rollover: { from: "2026-08" } }, "2026-10", TODAY)).toBe(1.7);
  });
});

describe("envelope", () => {
  it("is the budget plus what was carried, less what was spent", () => {
    const data = { cutoffDay: 1, months: { "2026-09": month(spend(150)), "2026-10": month() } };
    const e = envelope(data, { name: "Gifts", cap: 200, rollover: { from: "2026-09" } }, "2026-10", TODAY, 30);
    expect(e).toEqual({ cap: 200, carry: 50, available: 250, spent: 30, left: 220 });
  });

  it("has nothing available without a budget", () => {
    const e = envelope({ months: {} }, { name: "Gifts" }, "2026-10", TODAY, 30);
    expect(e.available).toBe(null);
    expect(e.left).toBe(null);
  });
});
