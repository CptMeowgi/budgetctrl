import { describe, it, expect } from "vitest";
import { copiesFor, missingCopies, nextPeriodOf, occursIn, weeklyDates } from "./occurrences.js";
import { monthlyCalendar } from "./calendar.js";
import { isoDay } from "./periods.js";

const iso = (dates) => dates.map(isoDay);
const oct = [new Date(2026, 9, 1), new Date(2026, 9, 31)];

describe("weeklyDates", () => {
  it("steps a week at a time from the first date", () => {
    expect(iso(weeklyDates({ repeat: "weeks", every: 1, startDate: "2026-10-02" }, ...oct)))
      .toEqual(["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]);
  });

  it("steps two weeks for every-other-week", () => {
    expect(iso(weeklyDates({ repeat: "weeks", every: 2, startDate: "2026-09-18" }, ...oct)))
      .toEqual(["2026-10-02", "2026-10-16", "2026-10-30"]);
  });

  it("starts mid-period: nothing before the first date", () => {
    expect(iso(weeklyDates({ repeat: "weeks", every: 1, startDate: "2026-10-20" }, ...oct)))
      .toEqual(["2026-10-20", "2026-10-27"]);
  });

  it("includes the period's last day", () => {
    expect(iso(weeklyDates({ repeat: "weeks", every: 1, startDate: "2026-10-03" }, ...oct)).at(-1)).toBe("2026-10-31");
  });

  it("clock changes: every Monday stays a Monday", () => {
    const spring = weeklyDates({ repeat: "weeks", every: 1, startDate: "2026-03-23" }, new Date(2026, 2, 1), new Date(2026, 3, 30));
    expect(iso(spring)).toEqual(["2026-03-23", "2026-03-30", "2026-04-06", "2026-04-13", "2026-04-20", "2026-04-27"]);
    const autumn = weeklyDates({ repeat: "weeks", every: 1, startDate: "2026-10-19" }, ...oct);
    expect(iso(autumn)).toEqual(["2026-10-19", "2026-10-26"]);
    expect([...spring, ...autumn].every((d) => d.getDay() === 1)).toBe(true);
  });

  it("gives nothing for a missing or broken first date", () => {
    expect(weeklyDates({ repeat: "weeks", every: 1 }, ...oct)).toEqual([]);
    expect(weeklyDates({ repeat: "weeks", every: 1, startDate: "soon" }, ...oct)).toEqual([]);
  });
});

describe("copiesFor", () => {
  const cal = monthlyCalendar(1);
  let n = 0;
  const newId = () => `id${++n}`;

  it("makes one dated copy per occurrence of a weekly item", () => {
    const tpl = { id: "t1", name: "Cleaner", amount: 40, repeat: "weeks", every: 2, startDate: "2026-10-02" };
    const copies = copiesFor(tpl, cal, "2026-10", newId);
    expect(copies.map((c) => [c.date, c.templateId, c.name])).toEqual([
      ["2026-10-02", "t1", "Cleaner"], ["2026-10-16", "t1", "Cleaner"], ["2026-10-30", "t1", "Cleaner"],
    ]);
    expect(new Set(copies.map((c) => c.id)).size).toBe(3);
  });

  it("makes a monthly item's copy exactly as before: undated, only on its cycle", () => {
    const rent = { id: "t2", name: "Rent", amount: 1000, dayOfMonth: 1 };
    expect(copiesFor(rent, cal, "2026-10", () => "x")).toEqual([{ ...rent, id: "x", templateId: "t2" }]);
    const insurance = { id: "t3", name: "Insurance", amount: 900, dayOfMonth: 10, every: 3, anchor: "2026-08" };
    expect(copiesFor(insurance, cal, "2026-10", () => "y")).toEqual([]);
    expect(copiesFor(insurance, cal, "2026-11", () => "y")).toHaveLength(1);
  });
});

describe("occursIn and nextPeriodOf", () => {
  const cal = monthlyCalendar(1);
  const later = { id: "t1", repeat: "weeks", every: 1, startDate: "2026-12-04" };

  it("say whether an item falls in a period", () => {
    expect(occursIn(later, cal, "2026-10")).toBe(false);
    expect(occursIn(later, cal, "2026-12")).toBe(true);
    expect(occursIn({ id: "m", dayOfMonth: 5 }, cal, "2026-10")).toBe(true);
  });

  it("name the next period an item falls in", () => {
    expect(nextPeriodOf(later, cal, "2026-10")).toBe("2026-12");
    expect(nextPeriodOf({ id: "q", dayOfMonth: 10, every: 3, anchor: "2026-08" }, cal, "2026-10")).toBe("2026-11");
  });
});

describe("missingCopies", () => {
  const cal = monthlyCalendar(1);
  const n = () => "n";
  const cleaner = { id: "t1", name: "Cleaner", amount: 40, repeat: "weeks", every: 1, startDate: "2026-10-02" };

  it("tops up a weekly item's missing dates without doubling the rest", () => {
    // What a payday change can leave: some of the period's copies, not all.
    const have = [{ id: "a", templateId: "t1", date: "2026-10-02" }, { id: "b", templateId: "t1", date: "2026-10-16" }];
    expect(missingCopies(cleaner, cal, "2026-10", have, n).map((c) => c.date)).toEqual(["2026-10-09", "2026-10-23", "2026-10-30"]);
  });

  it("finds a monthly item missing only when the period has no copy of it, as before", () => {
    const rent = { id: "t2", dayOfMonth: 1 };
    expect(missingCopies(rent, cal, "2026-10", [], n)).toHaveLength(1);
    expect(missingCopies(rent, cal, "2026-10", [{ id: "r", templateId: "t2" }], n)).toEqual([]);
    expect(missingCopies({ id: "t3", dayOfMonth: 5, every: 12, anchor: "2027-03" }, cal, "2026-10", [], n)).toEqual([]);
  });
});
