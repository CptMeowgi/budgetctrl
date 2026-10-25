import { describe, it, expect } from "vitest";
import { isPeriodLocked } from "./pastLock.js";
import { calendarFor } from "./calendar.js";

// Today is 25 Oct 2026.
const TODAY = new Date(2026, 9, 25, 12);
const budget = (lockPastMonths) => ({ cutoffDay: 1, lockPastMonths, months: {} });

describe("isPeriodLocked", () => {
  it("locks periods that ended more than the chosen months ago", () => {
    const d = budget(3);
    const cal = calendarFor(d);
    expect(isPeriodLocked(d, cal, "2026-06", TODAY)).toBe(true);   // ended 30 Jun, before 25 Jul
    expect(isPeriodLocked(d, cal, "2026-07", TODAY)).toBe(false);  // ended 31 Jul
    expect(isPeriodLocked(d, cal, "2025-01", TODAY)).toBe(true);
  });

  it("never locks the running period, or anything when the setting is off", () => {
    expect(isPeriodLocked(budget(1), calendarFor(budget(1)), "2026-10", TODAY)).toBe(false);
    expect(isPeriodLocked(budget(0), calendarFor(budget(0)), "2020-01", TODAY)).toBe(false);
    expect(isPeriodLocked(budget(undefined), calendarFor(budget(undefined)), "2020-01", TODAY)).toBe(false);
  });

  it("works on fortnights, by when each one ended", () => {
    const d = { cutoffDay: 1, lockPastMonths: 1, paySchedule: [{ kind: "weeks", every: 2, from: "2026-08-07" }], months: {} };
    const cal = calendarFor(d);
    expect(isPeriodLocked(d, cal, "2026-08-21", TODAY)).toBe(true);   // 21 Aug - 3 Sep
    expect(isPeriodLocked(d, cal, "2026-09-18", TODAY)).toBe(false);  // 18 Sep - 1 Oct, after 25 Sep
  });
});
