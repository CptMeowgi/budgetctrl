import { describe, it, expect, vi } from "vitest";
import { asCalendar, calendarFor, monthlyCalendar, readSchedule } from "./calendar.js";
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

// Paid on the 25th, monthly, until 6 Nov 2026; every two weeks from then.
const FORTNIGHTLY = [{ kind: "monthly", cutoffDay: 25 }, { kind: "weeks", every: 2, from: "2026-11-06" }];
const fortnightly = () => calendarFor({ cutoffDay: 25, paySchedule: FORTNIGHTLY });
const on = (y, m, d) => new Date(y, m - 1, d);
const span = (r) => [isoDay(r.start), isoDay(r.end)];
// Intl writes thin spaces around the dash in a range.
const plain = (s) => s.replace(/\s/g, " ");

describe("a budget paid every two weeks after a monthly start", () => {
  it("files each day in its period", () => {
    const cal = fortnightly();
    expect([on(2026, 10, 24), on(2026, 10, 25), on(2026, 11, 5), on(2026, 11, 6), on(2026, 11, 19), on(2026, 11, 20)].map(cal.keyFor))
      .toEqual(["2026-09", "2026-10", "2026-10", "2026-11-06", "2026-11-06", "2026-11-20"]);
    expect(cal.current(on(2026, 11, 21))).toBe("2026-11-20");
  });

  it("cuts the month running at the switch short, the day before the first payday", () => {
    const cal = fortnightly();
    expect(span(cal.range("2026-09"))).toEqual(["2026-09-25", "2026-10-24"]);
    expect(span(cal.range("2026-10"))).toEqual(["2026-10-25", "2026-11-05"]);
    expect(span(cal.range("2026-11-06"))).toEqual(["2026-11-06", "2026-11-19"]);
  });

  it("steps across the switch", () => {
    const cal = fortnightly();
    expect(cal.next("2026-10")).toBe("2026-11-06");
    expect(cal.prev("2026-11-06")).toBe("2026-10");
    expect(cal.shift("2026-09", 3)).toBe("2026-11-20");
    expect(cal.shift("2026-11-20", -3)).toBe("2026-09");
    expect(cal.between("2026-09", "2026-11-20")).toBe(3);
    expect(cal.between("2026-11-20", "2026-09")).toBe(-3);
  });

  it("keeps keys in date order as plain strings, and fortnights on their weekday", () => {
    const cal = fortnightly();
    const keys = [];
    for (let k = "2026-06"; keys.length < 20; k = cal.next(k)) keys.push(k);
    expect([...keys].sort()).toEqual(keys);
    const starts = keys.map((k) => isoDay(cal.range(k).start));
    expect([...starts].sort()).toEqual(starts);
    expect(keys.filter((k) => k.length === 10)).toHaveLength(15);
    // Through the clock change on 28 March 2027, every fortnight starts on a Friday.
    expect(keys.filter((k) => k.length === 10).every((k) => cal.range(k).start.getDay() === 5)).toBe(true);
  });

  it("lists every day once, the clock change included", () => {
    const cal = fortnightly();
    const days = cal.days("2026-10");
    expect(days).toHaveLength(12);
    expect(days.filter((d) => d === "2026-10-25")).toHaveLength(1);
    expect(cal.days("2026-11-06")).toHaveLength(14);
  });

  it("names its periods", () => {
    const cal = fortnightly();
    expect(plain(cal.label("2026-11-06").primary)).toBe("Nov 6 – 19, 2026");
    expect(cal.label("2026-11-06").range).toBeNull();
    expect(cal.label("2026-10")).toEqual({ primary: "October 2026", range: "Oct 25 – Nov 5" });
    expect(cal.label("2026-09")).toEqual(monthlyCalendar(25).label("2026-09"));
    expect([cal.shortLabel("2026-10"), cal.shortLabel("2026-11-06")]).toEqual(["Oct", "Nov 6"]);
  });

  it("tells monthly periods from fortnights", () => {
    const cal = fortnightly();
    expect(["2026-10", "2026-11-06"].map(cal.kindOf)).toEqual(["monthly", "weeks"]);
    expect(cal.sameKind("2026-11-06", "2026-11-20")).toBe(true);
    expect(cal.sameKind("2026-10", "2026-11-06")).toBe(false);
    expect([cal.periodsPerMonth("2026-10"), cal.periodsPerMonth("2026-11-06")]).toEqual([1, 26 / 12]);
    expect([cal.scheduled, cal.calendarMonths]).toEqual([true, false]);
  });

  it("answers due and new-entry questions by each period's own dates", () => {
    const cal = fortnightly();
    expect(isoDay(cal.dateOf(10, "2026-11-06"))).toBe("2026-11-10");
    expect(isoDay(cal.dateOf(10, "2026-11-20"))).toBe("2026-11-20"); // no 10th in it: its first day
    expect(cal.isDue({ dayOfMonth: 10 }, "2026-11-06", on(2026, 11, 9))).toBe(false);
    expect(cal.isDue({ dayOfMonth: 10 }, "2026-11-06", on(2026, 11, 10))).toBe(true);
    expect(cal.newEntryDate("2026-11-06", on(2026, 11, 9))).toBe("2026-11-09");
    expect(cal.newEntryDate("2026-11-20", on(2026, 11, 9))).toBe("2026-11-20");
  });

  it("puts a copy in a fortnight on its own date, and one in a month on its day", () => {
    const cal = fortnightly();
    expect(isoDay(cal.itemDate({ dayOfMonth: 10, date: "2026-11-12" }, "2026-11-06"))).toBe("2026-11-12");
    expect(isoDay(cal.itemDate({ dayOfMonth: 1, date: "2026-10-28" }, "2026-10"))).toBe("2026-11-01");
  });

  it("is the same calendar each time for the same schedule", () => {
    expect(calendarFor({ cutoffDay: 25, paySchedule: FORTNIGHTLY })).toBe(calendarFor({ paySchedule: FORTNIGHTLY }));
  });

  it("can't be changed by whoever holds it", () => {
    expect(Object.isFrozen(fortnightly())).toBe(true);
  });
});

describe("changing the schedule again", () => {
  it("cuts a fortnight short when payday moves earlier", () => {
    const cal = calendarFor({ paySchedule: [...FORTNIGHTLY, { kind: "weeks", every: 2, from: "2026-12-10" }] });
    expect(span(cal.range("2026-11-20"))).toEqual(["2026-11-20", "2026-12-03"]);
    expect(span(cal.range("2026-12-04"))).toEqual(["2026-12-04", "2026-12-09"]);
    expect(cal.next("2026-12-04")).toBe("2026-12-10");
    expect(span(cal.range("2026-12-10"))).toEqual(["2026-12-10", "2026-12-23"]);
  });

  it("goes back to monthly with keys that still sort by date", () => {
    const cal = calendarFor({ paySchedule: [...FORTNIGHTLY, { kind: "monthly", cutoffDay: 25, from: "2026-12-25" }] });
    expect(span(cal.range("2026-12-18"))).toEqual(["2026-12-18", "2026-12-24"]);
    expect(cal.next("2026-12-18")).toBe("2026-12-25");
    expect(span(cal.range("2026-12-25"))).toEqual(["2026-12-25", "2027-01-24"]);
    expect(cal.next("2026-12-25")).toBe("2027-01-25");
    expect(cal.kindOf("2026-12-25")).toBe("monthly");
    expect(cal.label("2026-12-25")).toEqual({ primary: "December 2026", range: "Dec 25 – Jan 24" });
    const keys = ["2026-10", "2026-11-06", "2026-12-04", "2026-12-18", "2026-12-25", "2027-01-25"];
    expect(keys.slice(1).map((k) => cal.prev(k))).toEqual(["2026-10", "2026-11-20", "2026-12-04", "2026-12-18", "2026-12-25"]);
    expect([...keys].sort()).toEqual(keys);
  });

  it("can start out weekly, counting paydays back from the first one", () => {
    const cal = calendarFor({ paySchedule: [{ kind: "weeks", every: 1, from: "2026-11-02" }] });
    expect(cal.keyFor(on(2026, 11, 1))).toBe("2026-10-26");
    expect(span(cal.range("2026-11-02"))).toEqual(["2026-11-02", "2026-11-08"]);
    expect(cal.periodsPerMonth("2026-11-02")).toBe(52 / 12);
  });
});

describe("a budget that never switched", () => {
  it("keeps its monthly calendar, with the new answers in monthly terms", () => {
    const cal = calendarFor({ cutoffDay: 25 });
    expect(cal.scheduled).toBe(false);
    expect([cal.kindOf("2026-10"), cal.sameKind("2026-09", "2026-10"), cal.periodsPerMonth("2026-10"), cal.shortLabel("2026-10")])
      .toEqual(["monthly", true, 1, "Oct"]);
    expect(calendarFor({ cutoffDay: 25, paySchedule: [{ kind: "monthly", cutoffDay: 25 }] }).scheduled).toBe(false);
  });
});

describe("a damaged pay schedule", () => {
  it("is ignored: the budget stays monthly on its payday, with one warning each", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = [
      [{ kind: "weeks", every: 2 }],
      [{ kind: "monthly", cutoffDay: 25 }, { kind: "weeks", every: 3, from: "2026-11-06" }],
      [{ kind: "monthly", cutoffDay: 25 }, { kind: "weeks", every: 2, from: "6 Nov" }],
      [{ kind: "monthly", cutoffDay: 25 }, { kind: "weeks", every: 2, from: "2026-11-06" }, { kind: "weeks", every: 1, from: "2026-11-01" }],
      "fortnightly",
      {},
    ];
    for (const paySchedule of broken) {
      const data = { cutoffDay: 25, paySchedule };
      expect(readSchedule(data)).toBeNull();
      expect(calendarFor(data).keyFor(on(2026, 11, 10))).toBe("2026-10");
      calendarFor(data); // asked again: no second warning
    }
    expect(warn).toHaveBeenCalledTimes(broken.length);
    warn.mockRestore();
  });

  it("still opens periods keyed by date, by their own dates", () => {
    const cal = monthlyCalendar(25);
    expect(span(cal.range("2026-11-06"))).toEqual(["2026-11-06", "2026-11-24"]);
    expect(cal.days("2026-11-06")).toHaveLength(19);
    expect(cal.kindOf("2026-11-06")).toBe("weeks");
    expect(plain(cal.label("2026-11-06").primary)).toBe("Nov 6 – 24, 2026");
    expect(() => fortnightly().label("not a key")).not.toThrow();
    expect(fortnightly().days("not a key")).toEqual([]);
  });
});

describe("running a period on to the next stretch", () => {
  it("monthly to fortnightly with the first payday after the month ends: the month runs on to it", () => {
    const cal = calendarFor({ paySchedule: [{ kind: "monthly", cutoffDay: 25 }, { kind: "weeks", every: 2, from: "2026-11-27", after: "2026-10-25" }] });
    expect(span(cal.range("2026-10"))).toEqual(["2026-10-25", "2026-11-26"]);
    expect(cal.keyFor(on(2026, 11, 25))).toBe("2026-10");
    expect(cal.next("2026-10")).toBe("2026-11-27");
    expect(cal.sameKind("2026-10", "2026-09")).toBe(false);
  });

  it("fortnightly, payday moved later: the running fortnight runs on to it", () => {
    const cal = calendarFor({ paySchedule: [...FORTNIGHTLY, { kind: "weeks", every: 2, from: "2026-12-10", after: "2026-11-20" }] });
    expect(span(cal.range("2026-11-20"))).toEqual(["2026-11-20", "2026-12-09"]);
    expect(cal.keyFor(on(2026, 12, 5))).toBe("2026-11-20");
    expect(cal.next("2026-11-20")).toBe("2026-12-10");
  });

  it("fortnightly back to monthly: the fortnight runs on to the payday", () => {
    const cal = calendarFor({ paySchedule: [...FORTNIGHTLY, { kind: "monthly", cutoffDay: 25, from: "2026-11-25", after: "2026-11-06" }] });
    expect(span(cal.range("2026-11-06"))).toEqual(["2026-11-06", "2026-11-24"]);
    expect(cal.next("2026-11-06")).toBe("2026-11-25");
    expect(span(cal.range("2026-11-25"))).toEqual(["2026-11-25", "2026-12-24"]);
  });

  it("refuses an `after` that isn't a date before `from`, on or after the stretch before", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = [
      [...FORTNIGHTLY, { kind: "weeks", every: 2, from: "2026-12-10", after: "2026-12-11" }],
      [...FORTNIGHTLY, { kind: "weeks", every: 2, from: "2026-12-10", after: "soon" }],
      [...FORTNIGHTLY, { kind: "weeks", every: 2, from: "2026-12-10", after: "2026-11-01" }],
    ];
    for (const paySchedule of broken) expect(readSchedule({ paySchedule })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(broken.length);
    warn.mockRestore();
  });
});
