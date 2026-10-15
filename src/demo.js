// A made-up budget for screenshots and for trying things in development:
// open the dev server with ?demo. Never part of the installed app - App only
// loads this behind import.meta.env.DEV.
//
// Everything is placed relative to `today`, so it always looks current: three
// finished months and this one up to today. `?demo&pay=fortnightly` gives the
// same budget paid every two weeks for the last two months.

import { addMonths } from "./lib/schedule.js";
import { isoDay, periodKeyFor } from "./lib/periods.js";
import { calendarFor } from "./lib/calendar.js";
import { copiesFor } from "./lib/occurrences.js";

// Same budget every time: a small deterministic random number generator.
function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

const SHOPS = [
  ["Lidl", "Groceries", 28, 74], ["Aldi", "Groceries", 22, 61], ["Rewe", "Groceries", 18, 55],
  ["Shell", "Transport", 45, 70], ["City transit", "Transport", 12, 30],
  ["The Daily Grind", "Eating out", 4, 9], ["Pizzeria Roma", "Eating out", 24, 48],
  ["Zara", "Shopping", 35, 90], ["Bookshop", "Fun", 12, 28], ["Cinema", "Fun", 11, 24], ["Pharmacy", "Health", 8, 32],
];

const RECURRING = [
  { id: "t-rent", name: "Rent", amount: 1450, dayOfMonth: 1, category: "Home" },
  { id: "t-gym", name: "Gym", amount: 35, dayOfMonth: 5, category: "Health", autoPay: true },
  { id: "t-power", name: "Electricity", amount: 85, dayOfMonth: 12, category: "Bills" },
  { id: "t-net", name: "Internet", amount: 39, dayOfMonth: 15, category: "Bills", autoPay: true },
  { id: "t-phone", name: "Phone", amount: 25, dayOfMonth: 18, category: "Bills" },
  { id: "t-music", name: "Spotify", amount: 11, dayOfMonth: 20, category: "Subscriptions", autoPay: true },
];

export function demoData(today, language = "en") {
  const rand = rng(20261011);
  const curKey = periodKeyFor(today, 1);
  const day = today.getDate();
  const iso = (key, d) => `${key}-${String(d).padStart(2, "0")}`;
  const money = (lo, hi) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
  let n = 0;
  const id = (p) => `${p}-${++n}`;

  const months = {};
  for (let back = 3; back >= 0; back--) {
    const key = addMonths(curKey, -back);
    const [y, m] = key.split("-").map(Number);
    const lastDay = back === 0 ? Math.max(1, day) : new Date(y, m, 0).getDate();
    const expenses = [];
    for (let d = 1; d <= lastDay; d++) {
      const visits = rand() < 0.55 ? 1 : rand() < 0.25 ? 2 : 0;
      for (let v = 0; v < visits; v++) {
        const [name, category, lo, hi] = SHOPS[Math.floor(rand() * SHOPS.length)];
        expenses.push({ id: id("e"), name, amount: money(lo, hi), date: iso(key, d), category });
      }
    }
    months[key] = {
      income: 4200,
      expenses,
      recurring: RECURRING.map((r) => ({ ...r, id: id("r"), templateId: r.id })),
      upcoming: back === 0
        ? [{ id: id("u"), name: "Car insurance", amount: 312, dueDate: isoDay(new Date(y, m - 1, Math.min(day + 3, 28))), category: "Transport", paid: false },
           { id: id("u"), name: "Dentist", amount: 120, dueDate: isoDay(new Date(y, m - 1, Math.min(day + 9, 28))), category: "Health", paid: false }]
        : [{ id: id("u"), name: "Car service", amount: 180, dueDate: iso(key, 22), category: "Transport", paid: true }],
      credits: back === 0
        ? [{ id: id("c"), name: "Tax refund", amount: 260, date: iso(key, Math.max(1, day - 4)), category: "Refund" }]
        : back === 2 ? [{ id: id("c"), name: "Birthday money", amount: 150, date: iso(key, 9), category: "Gift" }] : [],
    };
  }

  const start = addMonths(curKey, -3);
  const balanceDays = [0, 1, 2, 3].map((b) => iso(addMonths(start, b), 2));
  const balances = (values) => values.map((amount, i) => ({ date: balanceDays[i], amount }));

  return {
    months,
    language,
    currency: "EUR",
    locale: "en-GB",
    cutoffDay: 1,
    setupDone: true,
    savingsGoal: { monthly: 400 },
    reminders: { enabled: true, leadDays: 5 },
    recurringTemplate: RECURRING,
    creditTemplate: [],
    categories: [
      { name: "Uncategorized", color: "#9ca3af", icon: "·" },
      { name: "Groceries", color: "#10b981", icon: "🛒", cap: 520 },
      { name: "Home", color: "#8b5cf6", icon: "🏠" },
      { name: "Bills", color: "#0066cc", icon: "📄" },
      { name: "Transport", color: "#14b8a6", icon: "🚗", cap: 240 },
      { name: "Eating out", color: "#f97316", icon: "🍽️", cap: 160 },
      { name: "Health", color: "#ef4444", icon: "💊" },
      { name: "Shopping", color: "#ec4899", icon: "🛍️", cap: 150, rollover: true },
      { name: "Fun", color: "#f59e0b", icon: "🎮" },
      { name: "Subscriptions", color: "#6366f1", icon: "📺" },
    ],
    creditCategories: [
      { name: "Refund", color: "#10b981", icon: "↩" },
      { name: "Gift", color: "#ec4899", icon: "🎁" },
      { name: "Bonus", color: "#f59e0b", icon: "⭐" },
      { name: "Salary", color: "#0066cc", icon: "💼" },
      { name: "Other", color: "#9ca3af", icon: "·" },
    ],
    goals: [
      { id: "g-trip", name: "Holiday in Portugal", target: 7000, targetDate: addMonths(curKey, 7), source: "budget", startAmount: 300 },
      { id: "g-safe", name: "Emergency fund", target: 6000, source: "account", accountId: "a-save" },
    ],
    accounts: [
      { id: "a-cur", name: "Everyday account", kind: "current", balances: balances([2310, 2675, 2490, 2860]) },
      { id: "a-save", name: "Savings", kind: "savings", balances: balances([3400, 3750, 4100, 4480]) },
      { id: "a-card", name: "Credit card", kind: "card", balances: balances([420, 310, 560, 280]) },
    ],
  };
}

// The same budget, paid every two weeks from a Friday eight or nine weeks
// back: the months before stay months, the rest are fortnights, each with
// its paycheck and its bills.
export function fortnightlyDemo(today, language = "en") {
  const base = demoData(today, language);
  const day0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const firstPayday = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() - 56 - ((day0.getDay() + 2) % 7));
  const paySchedule = [{ kind: "monthly", cutoffDay: 1 }, { kind: "weeks", every: 2, from: isoDay(firstPayday) }];
  const cal = calendarFor({ paySchedule });
  const months = {};
  const period = (k) => {
    if (!months[k]) months[k] = { income: cal.kindOf(k) === "weeks" ? 1940 : 4200, expenses: [], recurring: [], upcoming: [], credits: [] };
    return months[k];
  };
  // A payment due after the running fortnight stays in it, as one added
  // today would; a later period is made when it begins.
  const running = cal.current(today);
  const upTo = (k) => (k > running ? running : k);
  for (const m of Object.values(base.months)) {
    for (const e of m.expenses) period(cal.keyFor(e.date)).expenses.push(e);
    for (const u of m.upcoming) period(upTo(cal.keyFor(u.dueDate))).upcoming.push(u);
    for (const c of m.credits) period(upTo(cal.keyFor(c.date))).credits.push(c);
  }
  let n = 0;
  for (let k = Object.keys(months).sort()[0]; k <= running; k = cal.next(k)) {
    period(k).recurring = base.recurringTemplate.flatMap((t) => copiesFor(t, cal, k, () => `fr-${++n}`));
  }
  return { ...base, months, paySchedule };
}
