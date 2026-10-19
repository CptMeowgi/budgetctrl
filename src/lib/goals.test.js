import { describe, it, expect } from "vitest";
import {
  leftOverHistory, accountPace, budgetPace, goalSaved, goalStatus, goalsMonthlyNeed, goalsNeedPerPeriod, goalAccountOptions, migrateGoals,
} from "./goals.js";

const D = (y, m, d) => new Date(y, m - 1, d);
const TODAY = D(2026, 10, 10);
const month = (income, spent) => ({ income, expenses: spent ? [{ amount: spent, category: "Food" }] : [], recurring: [], upcoming: [], credits: [] });

// Three closed months leaving 1000, 1500 and 2000; October is still running.
const data = {
  cutoffDay: 1,
  months: { "2026-07": month(8000, 7000), "2026-08": month(8000, 6500), "2026-09": month(8000, 6000), "2026-10": month(8000, 100) },
  accounts: [
    { id: "sav", name: "Savings", kind: "savings", balances: [{ date: "2026-07-10", amount: 10000 }, { date: "2026-10-10", amount: 13000 }] },
    { id: "cur", name: "Main", kind: "current", balances: [{ date: "2026-10-01", amount: 4000 }] },
    { id: "visa", name: "Visa", kind: "card", balances: [{ date: "2026-10-01", amount: 900 }] },
    { id: "old", name: "Old", kind: "savings", closed: true, balances: [] },
  ],
};

describe("leftOverHistory", () => {
  it("adds up what each closed month left over, leaving out the running one", () => {
    const h = leftOverHistory(data, TODAY);
    expect(h.monthsCounted).toBe(3);
    expect(h.series.slice(1).map((r) => r.delta)).toEqual([1000, 1500, 2000]);
    expect(h.total).toBe(4500);
    expect(h.series[h.series.length - 1].balance).toBe(4500);
  });
});

describe("pace", () => {
  it("averages an account's change per month", () => {
    // +3000 over 92 days is about 992 a month.
    expect(accountPace(data.accounts[0], "2026-10-10")).toBeCloseTo(3000 / (92 / 30.44), 5);
  });

  it("has no pace until there are four weeks of history", () => {
    expect(accountPace(data.accounts[1], "2026-10-10")).toBe(null);
    const short = { balances: [{ date: "2026-09-20", amount: 1 }, { date: "2026-10-10", amount: 2 }] };
    expect(accountPace(short, "2026-10-10")).toBe(null);
  });

  it("averages the last three closed months of the budget", () => {
    expect(budgetPace(leftOverHistory(data, TODAY))).toBe(1500);
  });
});

describe("goalStatus", () => {
  it("tracks an account's balance", () => {
    const s = goalStatus({ name: "Emergency", target: 20000, source: "account", accountId: "sav" }, data, TODAY);
    expect(s.saved).toBe(13000);
    expect(s.remaining).toBe(7000);
    expect(s.pct).toBeCloseTo(0.65);
  });

  it("says what a dated goal needs each month", () => {
    // October to June (exclusive): eight months to find 7000.
    const s = goalStatus({ target: 20000, source: "account", accountId: "sav", targetDate: "2027-06" }, data, TODAY);
    expect(s.monthsLeft).toBe(8);
    expect(s.neededPerMonth).toBe(7000 / 8);
  });

  it("says when it will get there at the current pace, and whether that misses the date", () => {
    const s = goalStatus({ target: 20000, source: "account", accountId: "sav", targetDate: "2027-03" }, data, TODAY);
    // 7000 at ~992 a month is 8 months: June 2027, after March.
    expect(s.eta).toBe("2027-06");
    expect(s.behind).toBe(true);
  });

  it("counts what the budget left over, plus what was saved before", () => {
    const s = goalStatus({ target: 30000, source: "budget", startAmount: 5180 }, data, TODAY);
    expect(s.saved).toBe(5180 + 4500);
    expect(s.pace).toBe(1500);
    expect(s.eta).toBe("2027-12"); // 20320 left at 1500 a month: 14 months from October 2026
  });

  it("is done, not overdue, once reached", () => {
    const s = goalStatus({ target: 10000, source: "account", accountId: "sav", targetDate: "2026-01" }, data, TODAY);
    expect(s.reached).toBe(true);
    expect(s.overdue).toBe(false);
    expect(s.neededPerMonth).toBe(null);
    expect(s.eta).toBe(null);
  });

  it("is overdue when the month has come and gone", () => {
    expect(goalStatus({ target: 99999, source: "account", accountId: "sav", targetDate: "2026-09" }, data, TODAY).overdue).toBe(true);
  });

  it("cannot say how much is saved when its account has gone", () => {
    const s = goalStatus({ target: 5000, source: "account", accountId: "deleted" }, data, TODAY);
    expect(s.saved).toBe(null);
    expect(s.pct).toBe(null);
    expect(goalSaved({ source: "account", accountId: "visa" }, data, TODAY)).toBe(null); // a debt is not savings
  });
});

describe("goalsMonthlyNeed", () => {
  it("adds up what the dated goals need", () => {
    const goals = [
      { target: 20000, source: "account", accountId: "sav", targetDate: "2027-06" }, // 875
      { target: 30000, source: "budget", startAmount: 5180 },                       // no date
    ];
    expect(goalsMonthlyNeed(goals, data, TODAY)).toBe(875);
  });
});

describe("goalAccountOptions", () => {
  it("offers open savings-type accounts not already behind another goal", () => {
    const goals = [{ id: "g1", source: "account", accountId: "sav" }];
    expect(goalAccountOptions(data.accounts, goals).map((a) => a.id)).toEqual(["cur"]);
    expect(goalAccountOptions(data.accounts, goals, "g1").map((a) => a.id)).toEqual(["sav", "cur"]);
  });
});

describe("migrateGoals", () => {
  let n = 0;
  const id = () => `g${++n}`;

  it("turns the old target and starting balance into a goal that reads the same", () => {
    const old = { ...data, savingsGoal: { monthly: 300, target: 30000 }, startingBalance: 5180 };
    const before = 5180 + leftOverHistory(old, TODAY).total; // what 0.4 showed as saved
    const out = migrateGoals(old, id);
    expect(out.goals).toEqual([{ id: "g1", name: "Savings", target: 30000, source: "budget", startAmount: 5180 }]);
    expect(goalSaved(out.goals[0], out, TODAY)).toBe(before);
    expect(out.savingsGoal).toEqual({ monthly: 300 });
    expect("startingBalance" in out).toBe(false);
  });

  it("creates nothing when there was no target and nothing saved", () => {
    expect(migrateGoals({ savingsGoal: { monthly: 0, target: 0 } }, id).goals).toEqual([]);
  });

  it("leaves existing goals alone, and runs safely twice", () => {
    const once = migrateGoals({ savingsGoal: { target: 100 }, startingBalance: 1 }, id);
    const twice = migrateGoals(once, id);
    expect(twice.goals).toEqual(once.goals);
  });
});

describe("goals in a budget paid every two weeks", () => {
  // Fortnights from 6 Nov 2026; today is in the one from 20 Nov. Nothing is
  // saved yet, so a 7,800 goal due in May 2027 needs 1,300 a month.
  const fortnightly = {
    paySchedule: [{ kind: "weeks", every: 2, from: "2026-11-06" }],
    months: { "2026-11-20": { income: 1900, expenses: [], recurring: [], upcoming: [], credits: [] } },
    goals: [{ id: "g", name: "Car", target: 7800, targetDate: "2027-05", source: "budget", startAmount: 0 }],
  };
  const NOV_21 = D(2026, 11, 21);

  it("say what they need per paycheck", () => {
    const st = goalStatus(fortnightly.goals[0], fortnightly, NOV_21);
    expect(st.neededPerMonth).toBe(1300);
    expect(st.perPeriod.needed).toBeCloseTo(600, 6);
    expect(goalsNeedPerPeriod(fortnightly.goals, fortnightly, NOV_21)).toBeCloseTo(600, 6);
  });

  it("in a monthly budget, per period is per month", () => {
    const st = goalStatus({ id: "h", target: 6000, targetDate: "2027-04", source: "budget", startAmount: 0 }, data, TODAY);
    expect(st.perPeriod.needed).toBe(st.neededPerMonth);
    expect(goalsNeedPerPeriod(data.goals || [], data, TODAY)).toBe(goalsMonthlyNeed(data.goals || [], data, TODAY));
  });
});
