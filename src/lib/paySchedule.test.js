import { describe, it, expect } from "vitest";
import { firstPaydayFor, payKindChosen, payKindNow, switchSchedule } from "./paySchedule.js";
import { calendarFor } from "./calendar.js";
import { capAt, carryInto } from "./envelopes.js";

// Paid on the 25th; today is 2 Nov 2026, in the period "2026-10" (25 Oct -
// 24 Nov). Rent falls on the 1st and the phone bill on the 10th.
const TODAY = new Date(2026, 10, 2, 12);
const B = () => ({
  cutoffDay: 25,
  months: {
    "2026-09": { income: 4000, recurring: [], upcoming: [], credits: [],
      expenses: [{ id: "e1", name: "Shop", amount: 100, date: "2026-10-01", category: "Food" }] },
    "2026-10": { income: 4000,
      expenses: [{ id: "e2", name: "Shop", amount: 50, date: "2026-10-28", category: "Food" },
                 { id: "e3", name: "Shop", amount: 70, date: "2026-11-08", category: "Food" }],
      recurring: [{ id: "r1", name: "Rent", amount: 1000, dayOfMonth: 1, templateId: "tr" },
                  { id: "r2", name: "Phone", amount: 50, dayOfMonth: 10, templateId: "tp" }],
      upcoming: [{ id: "u1", name: "Insurance", amount: 200, dueDate: "2026-11-10", paid: false }],
      credits: [{ id: "c1", name: "Refund", amount: 30, date: "2026-11-12", category: "Other" }] },
  },
  recurringTemplate: [{ id: "tr", name: "Rent", amount: 1000, dayOfMonth: 1 }, { id: "tp", name: "Phone", amount: 50, dayOfMonth: 10 }],
  creditTemplate: [],
  categories: [{ name: "Food", cap: 1300, rollover: { from: "2026-09" } }, { name: "Fun", cap: 260 }, { name: "Uncategorized" }],
  savingsGoal: { monthly: 650 },
});
const fortnights = (payday = "2026-11-06", today = TODAY, extra = {}) =>
  switchSchedule(B(), { kind: "weeks", every: 2, firstPayday: payday, ...extra }, today);
const ids = (list) => (list || []).map((x) => x.id);
const plain = (s) => s.replace(/\s/g, " ");
const food = (data) => data.categories.find((c) => c.name === "Food");

describe("switching to fortnights", () => {
  it("the running month ends the day before the first payday", () => {
    const { data, preview } = fortnights();
    expect(data.paySchedule).toEqual([{ kind: "monthly", cutoffDay: 25 }, { kind: "weeks", every: 2, from: "2026-11-06", after: "2026-10-25" }]);
    expect(preview.error).toBeNull();
    expect(preview.current).toEqual({ key: "2026-10", start: "2026-10-25", end: "2026-11-05", change: "shortened" });
    expect(preview.firstKey).toBe("2026-11-06");
    expect(preview.periods.map(plain)).toEqual(["Nov 6 – 19, 2026", "Nov 20 – Dec 3, 2026", "Dec 4 – 17, 2026"]);
  });

  it("entries dated on or after it move into the first fortnight", () => {
    const { data, preview } = fortnights();
    expect(preview.moved).toBe(4);
    const oct = data.months["2026-10"];
    expect([ids(oct.expenses), ids(oct.recurring), oct.upcoming, oct.credits]).toEqual([["e2"], ["r1"], [], []]);
    // The running month keeps its income and its own fields; only entries move.
    expect(oct.income).toBe(4000);
    const first = data.months["2026-11-06"];
    expect([ids(first.expenses), ids(first.upcoming), ids(first.credits)]).toEqual([["e3"], ["u1"], ["c1"]]);
    expect(first.recurring.map((r) => [r.name, r.date])).toEqual([["Phone", "2026-11-10"]]);
  });

  it("the first fortnight's income is the paycheck", () => {
    const { data, preview } = fortnights();
    expect(preview.paycheck).toBe(1846);
    expect(data.months["2026-11-06"].income).toBe(1846);
    expect(fortnights("2026-11-06", TODAY, { paycheck: 1900 }).data.months["2026-11-06"].income).toBe(1900);
  });

  it("budgets and the set-aside convert per period, rounded", () => {
    const { data, preview } = fortnights();
    expect(preview.budgets).toEqual([{ name: "Food", before: 1300, after: 600 }, { name: "Fun", before: 260, after: 120 }]);
    expect([capAt(food(data), "2026-10"), capAt(food(data), "2026-11-06")]).toEqual([1300, 600]);
    // The set-aside is kept per month and shown per period, so it needs no converting.
    expect(preview.setAside).toEqual({ before: 650, after: 300 });
    expect(data.savingsGoal.monthly).toBe(650);
  });

  it("rollover carries into the first fortnight", () => {
    const { data } = fortnights();
    expect(carryInto(data, food(data), "2026-11-06", TODAY)).toBe((1300 - 100) + (1300 - 50));
  });

  it("leaves the budget it was given untouched, and every period before the running one", () => {
    const b = B();
    const before = structuredClone(b);
    const { data } = switchSchedule(b, { kind: "weeks", every: 2, firstPayday: "2026-11-06" }, TODAY);
    expect(b).toEqual(before);
    expect(data.months["2026-09"]).toEqual(before.months["2026-09"]);
  });

  it("a payday after the month ends lengthens it", () => {
    const { data, preview } = fortnights("2026-11-27");
    expect([preview.current.end, preview.current.change, preview.moved]).toEqual(["2026-11-26", "lengthened", 0]);
    const first = data.months["2026-11-27"];
    expect(first.income).toBe(1846);
    expect(first.recurring.filter((r) => r.name === "Rent").map((r) => r.date)).toEqual(["2026-12-01"]);
  });

  it("a payday on the period's first day, or more than 31 days after it ends, is refused", () => {
    const b = B();
    for (const [payday, error] of [["2026-10-25", "too-early"], ["2026-12-26", "too-late"]]) {
      const out = switchSchedule(b, { kind: "weeks", every: 2, firstPayday: payday }, TODAY);
      expect(out.preview.error).toBe(error);
      expect(out.data).toBe(b);
    }
  });

  it("a late switch makes each new period up to today's", () => {
    const { data } = fortnights("2026-11-06", new Date(2026, 10, 21, 12));
    expect(Object.keys(data.months).sort()).toEqual(["2026-09", "2026-10", "2026-11-06", "2026-11-20"]);
    const second = data.months["2026-11-20"];
    expect(second.income).toBe(1846);
    expect(second.recurring.filter((r) => r.name === "Rent").map((r) => r.date)).toEqual(["2026-12-01"]);
  });

  it("a second switch before the first begins replaces it", () => {
    const once = fortnights("2026-11-27").data;
    const { data } = switchSchedule(once, { kind: "weeks", every: 2, firstPayday: "2026-11-12" }, TODAY);
    expect(data.paySchedule.filter((e) => e.kind === "weeks")).toEqual([{ kind: "weeks", every: 2, from: "2026-11-12", after: "2026-10-25" }]);
    const cal = calendarFor(data);
    expect(Object.keys(data.months).sort()).toEqual(["2026-09", "2026-10", "2026-11-12"]);
    for (const k of Object.keys(data.months)) expect(cal.keyFor(cal.range(k).start)).toBe(k);
    expect(ids(data.months["2026-11-12"].credits)).toEqual(["c1"]);
    // The replaced switch leaves no budgets behind.
    expect(food(data).capHistory.map((h) => h.from).filter((f) => f > "2026-10")).toEqual(["2026-11-12"]);
  });

  it("taking back a switch still to come restores the month as it was", () => {
    const pending = fortnights("2026-11-27").data;
    const { data, preview } = switchSchedule(pending, { kind: "monthly", cutoffDay: 25 }, TODAY);
    expect("paySchedule" in data).toBe(false);
    expect(Object.keys(data.months).sort()).toEqual(["2026-09", "2026-10"]);
    expect([preview.current.end, preview.current.change]).toEqual(["2026-11-24", "shortened"]);
    expect(capAt(food(data), "2026-11")).toBe(1300);
    expect(data.months["2026-10"].income).toBe(4000);
  });

  it("a budget in its first period switches", () => {
    const b = B();
    delete b.months["2026-09"];
    const { data, preview } = switchSchedule(b, { kind: "weeks", every: 2, firstPayday: "2026-11-06" }, TODAY);
    expect(preview.moved).toBe(4);
    expect(Object.keys(data.months).sort()).toEqual(["2026-10", "2026-11-06"]);
  });

  it("says how the budget is set to be paid, whether or not that has begun", () => {
    expect(payKindChosen(B())).toBe("monthly");
    expect(payKindChosen(fortnights("2026-11-27").data)).toBe("weeks:2");
  });

  it("says how the running period is paid", () => {
    expect(payKindNow(B(), TODAY)).toBe("monthly");
    expect(payKindNow(fortnights().data, new Date(2026, 10, 10, 12))).toBe("weeks:2");
    expect(payKindNow(fortnights().data, TODAY)).toBe("monthly");
  });
});

describe("switching again", () => {
  const TEN_NOV = new Date(2026, 10, 10, 12);

  it("back to monthly: the fortnight runs on to the payday", () => {
    const f = fortnights().data;
    expect(firstPaydayFor(f, 25, TEN_NOV)).toBe("2026-11-25");
    const { data, preview } = switchSchedule(f, { kind: "monthly", cutoffDay: 25 }, TEN_NOV);
    expect(data.paySchedule[data.paySchedule.length - 1]).toEqual({ kind: "monthly", cutoffDay: 25, from: "2026-11-25", after: "2026-11-06" });
    expect([preview.current.end, preview.current.change]).toEqual(["2026-11-24", "lengthened"]);
    expect(capAt(food(data), "2026-11-25")).toBe(1300);
    expect(data.cutoffDay).toBe(25);
  });

  it("weekly to fortnightly doubles budgets", () => {
    const weekly = {
      cutoffDay: 1, paySchedule: [{ kind: "weeks", every: 1, from: "2026-11-02" }],
      months: { "2026-11-02": { income: 1000, expenses: [], recurring: [], upcoming: [], credits: [] } },
      recurringTemplate: [], creditTemplate: [], categories: [{ name: "Food", cap: 500 }], savingsGoal: { monthly: 0 },
    };
    const { data, preview } = switchSchedule(weekly, { kind: "weeks", every: 2, firstPayday: "2026-11-09" }, new Date(2026, 10, 4, 12));
    expect(capAt(food(data), "2026-11-09")).toBe(1000);
    expect(preview.paycheck).toBe(2000);
  });

  it("a new payday on the same schedule shortens or lengthens the fortnight", () => {
    const f = fortnights().data;
    const earlier = switchSchedule(f, { kind: "weeks", every: 2, firstPayday: "2026-11-16" }, TEN_NOV).preview;
    const later = switchSchedule(f, { kind: "weeks", every: 2, firstPayday: "2026-11-24" }, TEN_NOV).preview;
    expect([earlier.current.end, earlier.current.change]).toEqual(["2026-11-15", "shortened"]);
    expect([later.current.end, later.current.change]).toEqual(["2026-11-23", "lengthened"]);
    expect(later.budgets.every((b) => b.before === b.after)).toBe(true);
  });
});
