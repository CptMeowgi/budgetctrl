import { describe, it, expect } from "vitest";
import { monthsBetween, addMonths, isOnCycle, nextOnCycle, frequencyLabel, everyFromLabel, FREQUENCIES, dayOfMonthFrom, REPEAT_OPTIONS, repeatLabel, scheduleFromForm } from "./schedule.js";

describe("dayOfMonthFrom", () => {
  it("keeps a typed day to a whole day of the month", () => {
    expect(dayOfMonthFrom("15")).toBe(15);
    expect(dayOfMonthFrom("45")).toBe(31);
    expect(dayOfMonthFrom("2.6")).toBe(3);
    expect(dayOfMonthFrom("0")).toBe(1);
    expect(dayOfMonthFrom("-4")).toBe(1);
    expect(dayOfMonthFrom("")).toBe(1);
    expect(dayOfMonthFrom("soon")).toBe(1);
  });
});

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

describe("repeat settings from the form", () => {
  it("offers weekly choices before the monthly ones", () => {
    expect(REPEAT_OPTIONS.map((o) => o.label).slice(0, 3)).toEqual(["Every week", "Every 2 weeks", "Monthly"]);
  });

  it("names an item's repeat", () => {
    expect(repeatLabel({ repeat: "weeks", every: 2 })).toBe("Every 2 weeks");
    expect(repeatLabel({ repeat: "weeks", every: 1 })).toBe("Every week");
    expect(repeatLabel({ every: 3, anchor: "2026-08" })).toBe("Quarterly");
    expect(repeatLabel({ dayOfMonth: 5 })).toBe("Monthly");
  });

  it("builds a weekly schedule, with no day of the month", () => {
    expect(scheduleFromForm({ repeats: "Every 2 weeks", startDate: "2026-10-16" }, {}, "2026-10", "2026-10-14"))
      .toEqual({ repeat: "weeks", every: 2, startDate: "2026-10-16", dayOfMonth: undefined, anchor: undefined });
    expect(scheduleFromForm({ repeats: "Every week" }, {}, "2026-10", "2026-10-14").startDate).toBe("2026-10-14");
  });

  it("keeps a weekly item weekly when the form has no Repeats (a past period)", () => {
    expect(scheduleFromForm({}, { repeat: "weeks", every: 2, startDate: "2026-09-04" }, "2026-09", "x"))
      .toEqual({ repeat: "weeks", every: 2, startDate: "2026-09-04", dayOfMonth: undefined, anchor: undefined });
  });

  it("builds monthly schedules exactly as the form always has", () => {
    expect(scheduleFromForm({ repeats: "Monthly" }, {}, "2026-10", "x")).toEqual({ every: undefined, anchor: undefined, repeat: undefined, startDate: undefined });
    expect(scheduleFromForm({ repeats: "Quarterly", anchor: "2026-11" }, {}, "2026-10", "x"))
      .toEqual({ every: 3, anchor: "2026-11", repeat: undefined, startDate: undefined });
    expect(scheduleFromForm({}, { every: 12, anchor: "2026-03" }, "2026-10", "x"))
      .toEqual({ every: 12, anchor: "2026-03", repeat: undefined, startDate: undefined });
  });
});
