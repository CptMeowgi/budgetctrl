import { describe, it, expect } from "vitest";
import { sinkingFunds, fundTotals, canSaveUp } from "./sinking.js";

// Paid on the 1st; today is 20 Oct 2026. Car insurance, 1,200 a year, is due
// on 10 March: last paid March 2026, next March 2027.
const TODAY = new Date(2026, 9, 20, 12);
const month = (o = {}) => ({ income: 3000, expenses: [], recurring: [], upcoming: [], credits: [], ...o });
const insurance = (saveFrom = "2026-04", extra = {}) => ({
  id: "ins", name: "Car insurance", amount: 1200, dayOfMonth: 10, every: 12, anchor: "2026-03", category: "Bills",
  ...(saveFrom ? { saveUp: { from: saveFrom } } : {}), ...extra,
});
const budget = (tpl = insurance(), months = {}) => {
  const all = {};
  for (let m = 4; m <= 10; m++) all[`2026-${String(m).padStart(2, "0")}`] = month();
  return { cutoffDay: 1, savingsGoal: { monthly: 0 }, recurringTemplate: [tpl], months: { ...all, ...months } };
};

describe("canSaveUp", () => {
  it("is for bills that come round every few months or once a year", () => {
    expect(canSaveUp({ every: 12, anchor: "2026-03", dayOfMonth: 10 })).toBe(true);
    expect(canSaveUp({ every: 3, anchor: "2026-01", dayOfMonth: 1 })).toBe(true);
    expect(canSaveUp({ dayOfMonth: 1 })).toBe(false);
    expect(canSaveUp({ every: 1, dayOfMonth: 1 })).toBe(false);
    expect(canSaveUp({ repeat: "weeks", every: 2, startDate: "2026-10-02" })).toBe(false);
  });
});

describe("sinkingFunds", () => {
  it("sets aside the bill in equal shares over the periods to its due date", () => {
    const [f] = sinkingFunds(budget(), TODAY);
    expect(f).toMatchObject({ id: "ins", amount: 1200, dueKey: "2027-03", dueDate: "2027-03-10", periodsLeft: 6, dueNow: false });
    // April to September have set aside 100 each; October's share is 100 too.
    expect([f.saved, f.thisPeriod, f.savedAfter]).toEqual([600, 100, 700]);
  });

  it("asks for more each period when saving started late", () => {
    const [f] = sinkingFunds(budget(insurance("2026-10")), TODAY);
    expect([f.saved, f.thisPeriod, f.periodsLeft]).toEqual([0, 200, 6]);
  });

  it("catches up after a period with nothing left over to save", () => {
    // July spent everything it had.
    const d = budget(insurance(), { "2026-07": month({ expenses: [{ id: "x", name: "Car repair", amount: 3000, date: "2026-07-05", category: "Car" }] }) });
    const [f] = sinkingFunds(d, TODAY);
    // July saved nothing, so August on each set aside a little more: 900/8.
    expect(f.saved).toBe(525);
    expect(f.thisPeriod).toBe(112.5);
  });

  it("saves only what a period had left over", () => {
    const d = budget(insurance(), { "2026-08": month({ expenses: [{ id: "x", name: "Holiday", amount: 2960, date: "2026-08-05", category: "Fun" }] }) });
    const [f] = sinkingFunds(d, TODAY);
    // August had only 40 left, so September set aside 760/7.
    expect(f.saved).toBe(548.57);
  });

  it("in the period it's due, pays the bill out of what was saved once it's paid", () => {
    const due = budget(insurance(), {});
    for (let m = 11; m <= 12; m++) due.months[`2026-${m}`] = month();
    for (let m = 1; m <= 3; m++) due.months[`2027-0${m}`] = month();
    due.months["2027-03"].recurring = [{ id: "r", name: "Car insurance", amount: 1200, dayOfMonth: 10, every: 12, anchor: "2026-03", templateId: "ins" }];
    const before = sinkingFunds(due, new Date(2027, 2, 5, 12))[0];
    expect([before.dueNow, before.saved, before.thisPeriod, before.paidFromFund]).toEqual([true, 1100, 100, 0]);
    const after = sinkingFunds(due, new Date(2027, 2, 15, 12))[0];
    expect(after.paidFromFund).toBe(1200);
    expect(fundTotals(sinkingFunds(due, new Date(2027, 2, 15, 12)))).toEqual({ setAside: 100, paidFromFund: 1200 });
  });

  it("starts again after the bill is paid", () => {
    const d = budget(insurance("2025-04"));
    d.months["2026-03"] = month({ recurring: [{ id: "old", name: "Car insurance", amount: 1200, dayOfMonth: 10, every: 12, anchor: "2026-03", templateId: "ins" }] });
    const [f] = sinkingFunds(d, TODAY);
    expect([f.saved, f.thisPeriod]).toEqual([600, 100]);
  });

  it("works per paycheck in a budget paid every two weeks", () => {
    const d = { cutoffDay: 1, savingsGoal: { monthly: 0 }, paySchedule: [{ kind: "weeks", every: 2, from: "2026-10-09" }],
      recurringTemplate: [insurance("2026-10-09")], months: { "2026-10-09": month({ income: 1500 }) } };
    const [f] = sinkingFunds(d, new Date(2026, 9, 12, 12));
    // 9 Oct 2026 to the fortnight with 10 March 2027 in it: 11 fortnights.
    expect(f.periodsLeft).toBe(11);
    expect(f.thisPeriod).toBe(109.09);
  });

  it("leaves out bills not being saved for, and needs nothing to be well formed", () => {
    expect(sinkingFunds(budget(insurance(null)), TODAY)).toEqual([]);
    expect(sinkingFunds({ months: {} }, TODAY)).toEqual([]);
    expect(fundTotals([])).toEqual({ setAside: 0, paidFromFund: 0 });
  });
});
