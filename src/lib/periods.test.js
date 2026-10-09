import { describe, it, expect } from "vitest";
import {
  periodKeyFor, periodRange, periodLabel, recurringDateInPeriod, isRecurringDue,
  isoDay, daysBetween, daysInCalMonth,
} from "./periods.js";

const D = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const day = (d) => isoDay(d);

describe("environment", () => {
  it("runs off UTC, so a toISOString() slip would show up here", () => {
    expect(new Date(2026, 9, 9).getTimezoneOffset()).not.toBe(0);
  });
});

describe("isoDay", () => {
  it("uses the local calendar day, not UTC", () => {
    // 00:30 local in Warsaw is still the previous day in UTC - the exact case
    // toISOString() got wrong.
    expect(isoDay(D(2026, 10, 9, 0, 30))).toBe("2026-10-09");
    expect(isoDay(D(2026, 1, 1, 0, 5))).toBe("2026-01-01");
  });
});

describe("periodKeyFor", () => {
  it("is the calendar month when the cutoff is 1", () => {
    expect(periodKeyFor(D(2026, 9, 1), 1)).toBe("2026-09");
    expect(periodKeyFor(D(2026, 9, 30), 1)).toBe("2026-09");
  });
  it("belongs to the previous period before the cutoff day", () => {
    expect(periodKeyFor(D(2026, 9, 9), 10)).toBe("2026-08");
    expect(periodKeyFor(D(2026, 9, 10), 10)).toBe("2026-09");
  });
  it("crosses the year boundary backwards", () => {
    expect(periodKeyFor(D(2027, 1, 5), 10)).toBe("2026-12");
  });
  it("returns null for an unparseable date", () => {
    expect(periodKeyFor("not a date", 1)).toBe(null);
  });
});

describe("periodRange", () => {
  it("runs cutoff-to-day-before-cutoff", () => {
    const { start, end } = periodRange("2026-09", 10);
    expect([day(start), day(end)]).toEqual(["2026-09-10", "2026-10-09"]);
  });
  it("is the whole calendar month at cutoff 1, including February", () => {
    const { start, end } = periodRange("2026-02", 1);
    expect([day(start), day(end)]).toEqual(["2026-02-01", "2026-02-28"]);
  });
  it("crosses into the next year", () => {
    const { start, end } = periodRange("2026-12", 10);
    expect([day(start), day(end)]).toEqual(["2026-12-10", "2027-01-09"]);
  });
  it("labels the range only when the cutoff is not 1", () => {
    expect(periodLabel("2026-09", 1).range).toBe(null);
    expect(periodLabel("2026-09", 10).range).toMatch(/Sep.*Oct/);
  });
});

describe("recurringDateInPeriod", () => {
  it("resolves a day inside the starting calendar month", () => {
    expect(day(recurringDateInPeriod(15, "2026-09", 10))).toBe("2026-09-15");
  });
  it("resolves a day before the cutoff into the following calendar month", () => {
    // Cutoff 10: the 5th of September precedes the period, so the bill lands on
    // the 5th of October.
    expect(day(recurringDateInPeriod(5, "2026-09", 10))).toBe("2026-10-05");
  });
  it("clamps day 31 to the end of a short month instead of never firing", () => {
    expect(day(recurringDateInPeriod(31, "2026-02", 1))).toBe("2026-02-28");
    expect(day(recurringDateInPeriod(31, "2028-02", 1))).toBe("2028-02-29"); // leap year
    expect(day(recurringDateInPeriod(31, "2026-04", 1))).toBe("2026-04-30");
  });
  it("knows month lengths", () => {
    expect([daysInCalMonth(2026, 2), daysInCalMonth(2028, 2), daysInCalMonth(2026, 12)]).toEqual([28, 29, 31]);
  });
});

describe("isRecurringDue", () => {
  const rent = { dayOfMonth: 15 };
  it("is not due before its day", () => {
    expect(isRecurringDue(rent, "2026-09", D(2026, 9, 14), 1)).toBe(false);
  });
  it("is due on its day and after", () => {
    expect(isRecurringDue(rent, "2026-09", D(2026, 9, 15), 1)).toBe(true);
    expect(isRecurringDue(rent, "2026-09", D(2026, 9, 29), 1)).toBe(true);
  });
  it("is due for any period that has fully passed", () => {
    expect(isRecurringDue(rent, "2026-08", D(2026, 9, 1), 1)).toBe(true);
  });
  it("is not due for a period that has not started", () => {
    expect(isRecurringDue(rent, "2026-10", D(2026, 9, 20), 1)).toBe(false);
  });
});

describe("daysBetween", () => {
  it("counts calendar days, unaffected by the DST change on 25 Oct 2026", () => {
    expect(daysBetween(D(2026, 10, 24), D(2026, 10, 26))).toBe(2);
    expect(daysBetween(D(2026, 3, 28), D(2026, 3, 30))).toBe(2); // spring forward
  });
  it("ignores the time of day", () => {
    expect(daysBetween(D(2026, 9, 14, 23, 59), D(2026, 9, 15, 0, 1))).toBe(1);
  });
});
