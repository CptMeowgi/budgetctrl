import { describe, it, expect } from "vitest";
import { asCalendar, calendarFor, monthlyCalendar } from "./calendar.js";
import { isRecurringDue, isoDay, newEntryDate, periodKeyFor, periodLabel, periodRange, recurringDateInPeriod } from "./periods.js";
import { addMonths, monthsBetween } from "./schedule.js";

// The calendar must give exactly the answers the period functions always
// have. Six years of days, every payday day: the arithmetic that has
// produced most of this app's bugs (short months, clock changes, year
// ends) gets checked against the original everywhere.
const days = [];
for (let d = new Date(2023, 0, 1); d < new Date(2029, 0, 1); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) days.push(d);

describe("monthlyCalendar matches the period functions", () => {
  it("puts every day in the same period, for every payday day", () => {
    for (let cutoff = 1; cutoff <= 31; cutoff++) {
      const cal = monthlyCalendar(cutoff);
      for (const d of days) {
        expect(cal.keyFor(d)).toBe(periodKeyFor(d, cutoff));
        expect(cal.current(d)).toBe(periodKeyFor(d, cutoff));
      }
    }
  });

  it("gives the same range, label and neighbours for every period", () => {
    for (let cutoff = 1; cutoff <= 31; cutoff++) {
      const cal = monthlyCalendar(cutoff);
      for (const key of new Set(days.map((d) => periodKeyFor(d, cutoff)))) {
        expect(cal.range(key)).toEqual(periodRange(key, cutoff));
        expect(cal.label(key)).toEqual(periodLabel(key, cutoff));
        expect(cal.next(key)).toBe(addMonths(key, 1));
        expect(cal.prev(key)).toBe(addMonths(key, -1));
        expect(cal.dateOf(31, key)).toEqual(recurringDateInPeriod(31, key, cutoff));
        expect(cal.dateOf(1, key)).toEqual(recurringDateInPeriod(1, key, cutoff));
      }
    }
  });

  it("lists every day of a period once, in order, from its start to its end", () => {
    for (const cutoff of [1, 10, 25, 29, 30, 31]) {
      const cal = monthlyCalendar(cutoff);
      for (const key of ["2026-01", "2026-02", "2026-03", "2026-10", "2026-12", "2028-02"]) {
        const list = cal.days(key);
        const { start, end } = cal.range(key);
        expect(list[0]).toBe(isoDay(start));
        expect(list[list.length - 1]).toBe(isoDay(end));
        expect(new Set(list).size).toBe(list.length);
        expect([...list].sort()).toEqual(list);
      }
    }
  });

  it("handles short months: a payday on the 30th, through February", () => {
    const cal = monthlyCalendar(30);
    expect(isoDay(cal.range("2027-01").start)).toBe("2027-01-30");
    expect(isoDay(cal.range("2027-01").end)).toBe("2027-02-27");
    expect(cal.keyFor(new Date(2027, 1, 28))).toBe("2027-02");
    expect(cal.days("2027-01").length).toBe(29);
  });

  it("handles clock changes: the 23-hour day in March is listed once", () => {
    const list = monthlyCalendar(1).days("2026-03");
    expect(list.length).toBe(31);
    expect(list).toContain("2026-03-29");
    expect(list).toContain("2026-03-30");
  });

  it("handles the year boundary", () => {
    const cal = monthlyCalendar(25);
    expect(cal.next("2026-12")).toBe("2027-01");
    expect(cal.prev("2027-01")).toBe("2026-12");
    expect(isoDay(cal.range("2026-12").end)).toBe("2027-01-24");
    expect(cal.between("2026-11", "2027-02")).toBe(monthsBetween("2026-11", "2027-02"));
    expect(cal.shift("2026-11", 3)).toBe("2027-02");
  });

  it("answers due and new-entry questions as before", () => {
    const cal = monthlyCalendar(25);
    const today = new Date(2026, 9, 12);
    const bill = { dayOfMonth: 1 };
    expect(cal.isDue(bill, "2026-09", today)).toBe(isRecurringDue(bill, "2026-09", today, 25));
    expect(cal.newEntryDate("2026-09", today)).toBe(newEntryDate("2026-09", 25, today));
    expect(cal.newEntryDate("2026-08", today)).toBe(newEntryDate("2026-08", 25, today));
    expect(cal.current(today)).toBe("2026-09");
  });
});

describe("building a calendar", () => {
  it("treats a missing or zero payday as the 1st", () => {
    expect(calendarFor({}).cutoffDay).toBe(1);
    expect(calendarFor({ cutoffDay: 0 }).cutoffDay).toBe(1);
    expect(calendarFor(undefined).cutoffDay).toBe(1);
    expect(asCalendar(undefined).cutoffDay).toBe(1);
  });

  it("reads the payday from the budget", () => {
    expect(calendarFor({ cutoffDay: 25 }).cutoffDay).toBe(25);
  });

  it("takes a payday number or a calendar alike", () => {
    const cal = monthlyCalendar(10);
    expect(asCalendar(cal)).toBe(cal);
    expect(asCalendar(10).keyFor(new Date(2026, 9, 5))).toBe("2026-09");
  });

  it("says when periods are plain calendar months", () => {
    expect(monthlyCalendar(1).calendarMonths).toBe(true);
    expect(monthlyCalendar(25).calendarMonths).toBe(false);
    expect(monthlyCalendar(1).kind).toBe("monthly");
  });

  it("can't be changed by whoever holds it", () => {
    expect(Object.isFrozen(monthlyCalendar(1))).toBe(true);
  });
});
