// Savings goals: a holiday, an emergency fund, a car. Each has a target, an
// optional month to reach it by, and something that says how much is saved:
//
//   account  the balance of one of your accounts (a savings account, say)
//   budget   what your budget has left over each month since you began, plus
//            whatever you had saved before - how the single savings goal of
//            0.4 worked, so it carries over unchanged
//
// From that and the recent pace, a goal says what it needs per month to land
// on its date, or when it will get there at the rate you are going.

import { periodSpending, periodIncome } from "./totals.js";
import { monthLabel, isoDay } from "./periods.js";
import { calendarFor } from "./calendar.js";
import { addMonths, monthsBetween } from "./schedule.js";
import { balanceAsOf, isLiability, addDays, daysBetweenISO, sortedBalances } from "./accounts.js";

export const GOAL_SOURCES = ["account", "budget"];

// What each closed period left over - income less spending - and the running
// total. The period still in progress is left out: it has not finished
// leaving anything over.
export function leftOverHistory(data, today) {
  const cal = calendarFor(data);
  const cur = cal.current(today);
  const keys = Object.keys(data.months || {}).filter((k) => k < cur).sort();
  let total = 0;
  const series = [{ key: "start", label: "Start", balance: 0, delta: 0, income: 0, spent: 0 }];
  for (const k of keys) {
    const m = data.months[k];
    const income = periodIncome(m, k, today, cal).total;
    const spent = periodSpending(m, k, today, cal).total;
    const delta = income - spent;
    total += delta;
    series.push({ key: k, label: monthLabel(k).slice(0, 3), balance: total, delta, income, spent, editedAt: m.editedAt || null });
  }
  return { total, series, monthsCounted: keys.length };
}

// Average change per month of an account's balance over roughly the last
// `days`. Null until there are four weeks of history to judge by.
export function accountPace(account, todayIso, days = 90) {
  const latest = balanceAsOf(account, todayIso);
  if (!latest) return null;
  const base = balanceAsOf(account, addDays(todayIso, -days)) || sortedBalances(account)[0];
  if (!base || base.date === latest.date) return null;
  const elapsed = daysBetweenISO(base.date, latest.date);
  if (elapsed < 28) return null;
  return (latest.amount - base.amount) / (elapsed / 30.44);
}

// Average left over across the last `n` closed periods.
export function budgetPace(history, n = 3) {
  const closed = history.series.slice(1).slice(-n);
  if (!closed.length) return null;
  return closed.reduce((a, r) => a + r.delta, 0) / closed.length;
}

export function goalAccount(goal, data) {
  if (goal.source !== "account") return null;
  return (data.accounts || []).find((a) => a.id === goal.accountId) || null;
}

// How much a goal has saved, or null when it cannot say - its account was
// deleted, or holds no balance yet.
export function goalSaved(goal, data, today, history = leftOverHistory(data, today)) {
  if (goal.source === "budget") return (Number(goal.startAmount) || 0) + history.total;
  const acc = goalAccount(goal, data);
  if (!acc || isLiability(acc)) return null;
  const b = balanceAsOf(acc, isoDay(today));
  return b ? b.amount : null;
}

export function goalStatus(goal, data, today, history = leftOverHistory(data, today)) {
  const cur = calendarFor(data).current(today);
  const saved = goalSaved(goal, data, today, history);
  const target = Number(goal.target) || 0;
  const known = saved != null;
  const remaining = known ? Math.max(0, target - saved) : null;
  const reached = known && target > 0 && saved >= target;

  // A goal due in June, viewed in October, has October..May: eight months.
  const monthsLeft = goal.targetDate ? monthsBetween(cur, goal.targetDate) : null;
  const neededPerMonth = known && !reached && monthsLeft != null && monthsLeft > 0 && target > 0
    ? remaining / monthsLeft : null;

  const acc = goalAccount(goal, data);
  const pace = goal.source === "budget" ? budgetPace(history)
    : acc ? accountPace(acc, isoDay(today)) : null;
  const eta = known && !reached && target > 0 && pace > 0 ? addMonths(cur, Math.ceil(remaining / pace)) : null;

  return {
    saved, target, remaining, reached,
    pct: known && target > 0 ? Math.max(0, Math.min(1, saved / target)) : null,
    monthsLeft, overdue: monthsLeft != null && monthsLeft <= 0 && !reached,
    neededPerMonth, pace, eta,
    // Would the date be missed at the current pace?
    behind: eta != null && goal.targetDate != null && eta > goal.targetDate,
  };
}

// What dated goals need set aside each month, together.
export function goalsMonthlyNeed(goals, data, today) {
  const history = leftOverHistory(data, today);
  return (goals || []).reduce((sum, g) => sum + (goalStatus(g, data, today, history).neededPerMonth || 0), 0);
}

// Accounts a goal can track: open, not a debt, and not already behind another
// goal - two goals counting one balance would each claim all of it.
export function goalAccountOptions(accounts, goals, exceptGoalId) {
  const taken = new Set((goals || []).filter((g) => g.id !== exceptGoalId && g.source === "account").map((g) => g.accountId));
  return (accounts || []).filter((a) => !a.closed && !isLiability(a) && !taken.has(a.id));
}

// 0.4 had one savings target, measured against what the budget left over plus
// a starting balance. It becomes a goal that does exactly that, so progress
// reads the same the day after upgrading.
export function migrateGoals(data, newId) {
  const out = { ...data };
  if (!Array.isArray(out.goals)) {
    const target = Number(out.savingsGoal?.target) || 0;
    const start = Number(out.startingBalance) || 0;
    out.goals = target > 0 || start > 0
      ? [{ id: newId(), name: "Savings", target, source: "budget", startAmount: start }]
      : [];
  }
  out.savingsGoal = { monthly: Number(out.savingsGoal?.monthly) || 0 };
  delete out.startingBalance;
  return out;
}
