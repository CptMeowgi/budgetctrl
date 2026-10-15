import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { calendarFor } from "./lib/calendar.js";
import { copiesFor, missingCopies, nextPeriodOf, occursIn } from "./lib/occurrences.js";
import { saveRecurring } from "./lib/recurringEdits.js";
import { convertToRecurring } from "./lib/regular.js";
import { hydrate, migrate } from "./model.js";
import { isoDay } from "./lib/periods.js";
import { comparisonFor, rangeKeys, rangeOptions } from "./lib/reports.js";
import { budgetPace, leftOverHistory } from "./lib/goals.js";
import { categoryAverage } from "./lib/totals.js";

// Paid on the 1st until 6 Nov 2026, every two weeks from then. "2026-10" is
// October, "2026-11" is cut short to 1-5 Nov, then the fortnights
// "2026-11-06" (6-19 Nov), "2026-11-20" (20 Nov - 3 Dec) and so on.
const SCHEDULE = [{ kind: "monthly", cutoffDay: 1 }, { kind: "weeks", every: 2, from: "2026-11-06" }];
const cal = calendarFor({ cutoffDay: 1, paySchedule: SCHEDULE });
const dates = (item, key) => cal.occurrences(item, key).map(isoDay);
let n = 0;
const newId = () => `id${++n}`;

describe("bills in fortnights", () => {
  it("a monthly bill lands in the fortnight that holds its day", () => {
    const rent = { id: "t", dayOfMonth: 10 };
    expect(dates(rent, "2026-11-06")).toEqual(["2026-11-10"]);
    expect(dates(rent, "2026-11-20")).toEqual([]);
    expect(dates(rent, "2026-12-04")).toEqual(["2026-12-10"]);
  });

  it("the 31st falls on the last day of shorter months, February included", () => {
    const bill = { id: "t", dayOfMonth: 31 };
    expect(dates(bill, "2026-11-20")).toEqual(["2026-11-30"]);
    expect(dates(bill, "2027-02-12")).toEqual([]);
    expect(dates(bill, "2027-02-26")).toEqual(["2027-02-28"]);
    expect(dates(bill, "2027-03-26")).toEqual(["2027-03-31"]);
  });

  it("the month cut short by the switch keeps only the bills dated before it", () => {
    expect(dates({ id: "a", dayOfMonth: 3 }, "2026-11")).toEqual(["2026-11-03"]);
    expect(dates({ id: "b", dayOfMonth: 10 }, "2026-11")).toEqual([]);
  });

  it("a weekly bill comes twice a fortnight, and four times in September", () => {
    const cleaner = { id: "w", repeat: "weeks", every: 1, startDate: "2026-09-07" };
    expect(dates(cleaner, "2026-11-06")).toEqual(["2026-11-09", "2026-11-16"]);
    expect(dates(cleaner, "2026-09")).toHaveLength(4);
    expect(dates(cleaner, "2026-11")).toEqual(["2026-11-02"]);
  });

  it("quarterly and yearly bills keep their cycle, counted by the month they fall in", () => {
    const quarterly = { id: "q", dayOfMonth: 15, every: 3, anchor: "2026-11" };
    const keys = ["2026-11-06", "2026-11-20", "2026-12-04", "2026-12-18", "2027-01-01", "2027-01-15", "2027-01-29", "2027-02-12"];
    expect(keys.filter((k) => occursIn(quarterly, cal, k))).toEqual(["2026-11-06", "2027-02-12"]);
    expect(nextPeriodOf(quarterly, cal, "2026-11-20")).toBe("2027-02-12");
    const yearly = { id: "y", dayOfMonth: 20, every: 12, anchor: "2026-11" };
    expect(occursIn(yearly, cal, "2026-11-20")).toBe(true);
    expect(nextPeriodOf(yearly, cal, "2026-12-04")).toBe("2027-11-19");
  });

  it("copies in a fortnight carry their dates; copies in a month don't, as before", () => {
    const rent = { id: "t", name: "Rent", amount: 900, dayOfMonth: 10 };
    expect(copiesFor(rent, cal, "2026-11-06", () => "x")).toEqual([{ ...rent, id: "x", templateId: "t", date: "2026-11-10" }]);
    expect(copiesFor(rent, cal, "2026-10", () => "y")).toEqual([{ ...rent, id: "y", templateId: "t" }]);
  });

  it("a fortnight missing a bill's copy gets it, without doubling one it has", () => {
    const rent = { id: "t", dayOfMonth: 10 };
    expect(missingCopies(rent, cal, "2026-11-06", [], newId).map((c) => c.date)).toEqual(["2026-11-10"]);
    expect(missingCopies(rent, cal, "2026-11-06", [{ id: "c", templateId: "t", date: "2026-11-10" }], newId)).toEqual([]);
  });
});

describe("a new fortnight", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 10, 21, 12)); });
  afterAll(() => vi.useRealTimers());

  it("gets each bill on its dates, and the last paycheck as its income", () => {
    const data = hydrate(migrate({
      cutoffDay: 1, paySchedule: SCHEDULE,
      months: { "2026-11-06": { income: 1900, expenses: [], recurring: [], upcoming: [], credits: [] } },
      recurringTemplate: [
        { id: "t1", name: "Rent", amount: 900, category: "Home", dayOfMonth: 1 },
        { id: "t2", name: "Cleaner", amount: 40, category: "Home", repeat: "weeks", every: 1, startDate: "2026-09-07" },
      ],
      creditTemplate: [],
    }));
    const p = data.months["2026-11-20"];
    expect(p.income).toBe(1900);
    expect(p.recurring.map((r) => [r.name, r.date])).toEqual([["Rent", "2026-12-01"], ["Cleaner", "2026-11-23"], ["Cleaner", "2026-11-30"]]);
    expect(data.paySchedule).toEqual(SCHEDULE);
  });
});

describe("editing a bill in a fortnight", () => {
  const MONTHLY = { every: undefined, anchor: undefined, repeat: undefined, startDate: undefined };
  const base = () => ({
    months: { "2026-11-06": { income: 0, expenses: [], upcoming: [], credits: [],
      recurring: [{ id: "c1", name: "Rent", amount: 900, dayOfMonth: 10, date: "2026-11-10", templateId: "t" }] } },
    recurringTemplate: [{ id: "t", name: "Rent", amount: 900, dayOfMonth: 10 }],
    creditTemplate: [],
  });
  const opts = (o) => ({ cal, curKey: "2026-11-06", targetKey: "2026-11-06", editingTpl: null, newId, ...o });

  it("moves its copy to the new day", () => {
    const b = base();
    const out = saveRecurring(b, "recurring", opts({ editing: b.months["2026-11-06"].recurring[0], fields: { name: "Rent", amount: 900, dayOfMonth: 15 }, schedule: MONTHLY }));
    expect(out.months["2026-11-06"].recurring.map((r) => [r.date, r.dayOfMonth])).toEqual([["2026-11-15", 15]]);
  });

  it("drops its copy when the new day falls in another fortnight", () => {
    const b = base();
    const out = saveRecurring(b, "recurring", opts({ editing: b.months["2026-11-06"].recurring[0], fields: { name: "Rent", amount: 900, dayOfMonth: 25 }, schedule: MONTHLY }));
    expect(out.months["2026-11-06"].recurring).toEqual([]);
    expect(out.recurringTemplate[0].dayOfMonth).toBe(25);
  });
});

describe("turning a regular payment into a bill in a fortnight", () => {
  const data = () => ({
    cutoffDay: 1, paySchedule: SCHEDULE,
    months: { "2026-11-06": { income: 0, recurring: [], upcoming: [], credits: [],
      expenses: [{ id: "e1", name: "Gym", amount: 30, date: "2026-11-07", category: "Health" }] } },
    recurringTemplate: [],
  });
  const suggestion = (dayOfMonth) => ({ name: "Gym", amount: 30, dayOfMonth, category: "Health", entries: [{ id: "e1", periodKey: "2026-11-06" }] });
  const today = new Date(2026, 10, 9, 12);

  it("swaps this fortnight's payment for the bill's copy when the bill falls here", () => {
    const out = convertToRecurring(data(), suggestion(7), newId, today).data.months["2026-11-06"];
    expect([out.expenses, out.recurring.map((r) => r.date)]).toEqual([[], ["2026-11-07"]]);
  });

  it("keeps the payment when the bill's day is in another fortnight", () => {
    const out = convertToRecurring(data(), suggestion(25), newId, today);
    expect(out.removed).toBe(0);
    expect(out.data.months["2026-11-06"].expenses.map((e) => e.id)).toEqual(["e1"]);
    expect(out.data.months["2026-11-06"].recurring).toEqual([]);
  });
});

// Food every period: 300 a month before the switch, 100 a fortnight after.
function switched() {
  const keys = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-11-06", "2026-11-20", "2026-12-04", "2026-12-18"];
  const months = {};
  for (const k of keys) {
    const fortnight = k.length === 10;
    months[k] = { income: fortnight ? 1900 : 4000, recurring: [], upcoming: [], credits: [],
      expenses: [{ id: `e-${k}`, name: "Shop", amount: fortnight ? 100 : 300, date: isoDay(cal.range(k).start), category: "Food" }] };
  }
  return { cutoffDay: 1, paySchedule: SCHEDULE, months, categories: [{ name: "Food" }] };
}
const TODAY = new Date(2026, 11, 20, 12); // in the fortnight "2026-12-18"

describe("reports on a budget that switched", () => {
  it("speaks of periods and counts back by period", () => {
    const data = switched();
    expect(rangeOptions(data, "2026-12-18").find((o) => o.id === "last:3").label).toBe("Last 3 periods");
    expect(rangeKeys(data, "last:3", "2026-12-18")).toEqual(["2026-11-06", "2026-11-20", "2026-12-04"]);
  });

  it("comparisons: never a fortnight against a month", () => {
    expect(comparisonFor(switched(), "last:3", "2026-12-18")).toBeNull();
  });

  it("comparisons: a year against the periods a year earlier, by date", () => {
    // Fortnights since 20 Dec 2024, 100 spent in each.
    const fortnights = [{ kind: "weeks", every: 2, from: "2024-12-20" }];
    const fcal = calendarFor({ paySchedule: fortnights });
    const months = {};
    for (let k = "2024-12-20"; k <= "2026-12-18"; k = fcal.next(k)) {
      months[k] = { income: 1900, expenses: [{ id: k, name: "Shop", amount: 100, date: k, category: "Food" }], recurring: [], upcoming: [], credits: [] };
    }
    const cmp = comparisonFor({ paySchedule: fortnights, months }, "year:2026", "2026-12-18");
    expect(cmp.label).toBe("2025");
    expect(cmp.keys).toHaveLength(cmp.closed.length);
    expect(cmp.closed[0]).toBe("2026-01-02");
    expect(cmp.keys[0]).toBe("2024-12-20");
  });
});

describe("goals and averages on a budget that switched", () => {
  it("label the fortnights by their days", () => {
    const h = leftOverHistory(switched(), TODAY);
    expect(h.series.slice(1).map((r) => r.label)).toEqual(["Aug", "Sep", "Oct", "Nov", "Nov 6", "Nov 20", "Dec 4"]);
  });

  it("count what fortnights leave over per month", () => {
    // Each fortnight leaves 1800: about 3900 a month.
    expect(budgetPace(leftOverHistory(switched(), TODAY))).toBeCloseTo(1800 * 26 / 12);
  });

  it("average a category over periods of the same kind only", () => {
    expect(categoryAverage(switched(), "Food", "2026-12-18", TODAY)).toBe(100);
  });
});
