import { describe, it, expect } from "vitest";
import { monthsBetween, addMonths, isOnCycle, nextOnCycle, frequencyLabel, everyFromLabel, FREQUENCIES } from "./schedule.js";

describe("month arithmetic on period keys", () => {
  it("counts months between keys, across years and backwards", () => {
    expect(monthsBetween("2026-10", "2026-10")).toBe(0);
    expect(monthsBetween("2026-10", "2027-03")).toBe(5);
    expect(monthsBetween("2026-03", "2025-12")).toBe(-3);
  });
  it("adds months, rolling the year both ways", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-12", 12)).toBe("2027-12");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("isOnCycle", () => {
  it("treats monthly items, and items saved before frequencies existed, as every period", () => {
    expect(isOnCycle({ every: 1, anchor: "2026-03" }, "2026-10")).toBe(true);
    expect(isOnCycle({ name: "legacy rent" }, "2026-10")).toBe(true);
  });

  it("puts a yearly bill in exactly one period per year", () => {
    const insurance = { every: 12, anchor: "2026-03" };
    const hits = [];
    for (let i = 0; i < 36; i++) {
      const k = addMonths("2026-01", i);
      if (isOnCycle(insurance, k)) hits.push(k);
    }
    expect(hits).toEqual(["2026-03", "2027-03", "2028-03"]);
  });

  it("puts a quarterly bill in every third period", () => {
    const q = { every: 3, anchor: "2026-01" };
    const hits = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-07", "2026-10"].filter((k) => isOnCycle(q, k));
    expect(hits).toEqual(["2026-01", "2026-04", "2026-07", "2026-10"]);
  });

  it("never fires before its anchor", () => {
    const later = { every: 12, anchor: "2027-03" };
    expect(isOnCycle(later, "2026-03")).toBe(false);
    expect(isOnCycle(later, "2026-10")).toBe(false);
    expect(isOnCycle(later, "2027-03")).toBe(true);
  });
});

describe("nextOnCycle", () => {
  it("is the current period when the item occurs in it", () => {
    expect(nextOnCycle({ every: 3, anchor: "2026-01" }, "2026-04")).toBe("2026-04");
    expect(nextOnCycle({ every: 1 }, "2026-10")).toBe("2026-10");
  });
  it("finds the next occurrence after the current period", () => {
    expect(nextOnCycle({ every: 12, anchor: "2026-03" }, "2026-10")).toBe("2027-03");
    expect(nextOnCycle({ every: 3, anchor: "2026-01" }, "2026-05")).toBe("2026-07");
  });
  it("is the anchor when the cycle has not started yet", () => {
    expect(nextOnCycle({ every: 12, anchor: "2027-03" }, "2026-10")).toBe("2027-03");
  });
  it("always lands on a period that isOnCycle agrees with", () => {
    const items = [{ every: 2, anchor: "2026-02" }, { every: 6, anchor: "2025-11" }, { every: 12, anchor: "2026-09" }];
    for (const it_ of items) {
      for (let i = 0; i < 30; i++) {
        const from = addMonths("2026-01", i);
        const next = nextOnCycle(it_, from);
        expect(isOnCycle(it_, next)).toBe(true);
        expect(monthsBetween(from, next)).toBeGreaterThanOrEqual(0);
        expect(monthsBetween(from, next)).toBeLessThan(it_.every);
      }
    }
  });
});

describe("labels", () => {
  it("round-trips every frequency through its label", () => {
    for (const f of FREQUENCIES) expect(everyFromLabel(frequencyLabel(f.every))).toBe(f.every);
  });
  it("defaults unknown or missing values to monthly", () => {
    expect(frequencyLabel(undefined)).toBe("Monthly");
    expect(everyFromLabel("nonsense")).toBe(1);
  });
});
