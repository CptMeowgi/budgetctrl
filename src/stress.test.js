import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { hydrate, migrate } from "./model.js";
import { periodKeyFor } from "./lib/periods.js";
import { periodSpending, periodIncome } from "./lib/totals.js";
import { envelope } from "./lib/envelopes.js";
import { search } from "./lib/search.js";
import { buildReport, rangeKeys } from "./lib/reports.js";
import { forecast, balanceHistory, spendingByDay } from "./lib/forecast.js";
import { findRegularPayments } from "./lib/regular.js";
import { goalsMonthlyNeed, leftOverHistory } from "./lib/goals.js";
import { analyzeImport } from "./lib/importer.js";

// Five years of heavy use: 60 payday periods, 150 purchases in each, bills,
// credits, upcoming payments, rollover budgets, accounts and import rules.
// Every screen recomputes from the whole budget, so anything that grows
// faster than the data (a loop over history inside a loop over history)
// shows up here long before anyone has five years of entries.
//
// Each of these takes well under 50 ms on a 2024 laptop. The limits are ten
// times that or more, so a busy CI machine passes and only a real slowdown
// fails. Each test also checks the work was really done: timing a
// calculation that quietly found nothing would prove nothing.

const CUTOFF = 10;
const TODAY = new Date(2026, 9, 12, 12);
const CUR = periodKeyFor(TODAY, CUTOFF);

function random(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

function fiveYears() {
  const rnd = random(42);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const money = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const names = ["Biedronka", "Lidl", "Żabka", "Orlen", "Rossmann", "Apteka", "Allegro", "Pyszne.pl", "Uber", "Kino", "IKEA", "Decathlon", "Empik", "Media Expert", "Bolt"];
  const categories = Array.from({ length: 20 }, (_, i) => ({
    name: `Category ${i}`, color: "#10b981", icon: "·",
    ...(i < 12 ? { cap: 400 + i * 50 } : {}),
    ...(i < 8 ? { rollover: { from: "2021-10" } } : {}),
  }));
  const templates = Array.from({ length: 10 }, (_, i) => ({
    id: `t${i}`, name: `Bill ${i}`, amount: money(30, 900), dayOfMonth: 1 + i * 2, category: categories[i].name,
    ...(i % 4 === 3 ? { every: 3, anchor: "2021-10" } : {}),
  }));
  const months = {};
  let id = 0;
  for (let p = 0; p < 61; p++) {
    const start = new Date(2021, 9 + p, CUTOFF);
    const key = periodKeyFor(start, CUTOFF);
    const day = (n) => iso(new Date(start.getFullYear(), start.getMonth(), CUTOFF + n));
    months[key] = {
      income: 9000 + p * 20,
      expenses: Array.from({ length: 150 }, () => {
        const amount = money(5, 400);
        const e = { id: `e${id++}`, name: pick(names), amount, date: day(Math.floor(rnd() * 28)), category: pick(categories).name };
        if (rnd() < 0.05) e.splits = [{ category: categories[0].name, amount: Math.round(amount * 50) / 100 }, { category: categories[1].name, amount: Math.round((amount - Math.round(amount * 50) / 100) * 100) / 100 }];
        if (rnd() < 0.3) { e.imported = true; e.note = `${e.name.toUpperCase()} 4521 KRAKOW`; }
        return e;
      }),
      // A period's bills are copies of the templates, without the schedule.
      recurring: templates.map((t) => ({ id: `r${id++}`, templateId: t.id, name: t.name, amount: t.amount, dayOfMonth: t.dayOfMonth, category: t.category })),
      upcoming: Array.from({ length: 8 }, (_, i) => ({ id: `u${id++}`, name: `Payment ${i}`, amount: money(20, 600), dueDate: day(i * 3), category: pick(categories).name, paid: rnd() < 0.8 })),
      credits: Array.from({ length: 4 }, (_, i) => ({ id: `c${id++}`, name: `Refund ${i}`, amount: money(10, 300), date: day(i * 6), category: "Refund" })),
    };
  }
  const accounts = [
    { id: "a1", name: "Current", kind: "current" },
    { id: "a2", name: "Savings", kind: "savings" },
    { id: "a3", name: "Card", kind: "card" },
  ].map((a, n) => ({ ...a, balances: Array.from({ length: 260 }, (_, w) => ({ date: iso(new Date(2021, 9, 4 + w * 7)), amount: money(1000 * (n + 1), 3000 * (n + 1)) })) }));
  return hydrate(migrate({
    months, cutoffDay: CUTOFF, categories, recurringTemplate: templates,
    creditCategories: [{ name: "Refund", color: "#10b981", icon: "↩" }, { name: "Other", color: "#9ca3af", icon: "·" }],
    creditTemplate: [], accounts,
    goals: [{ id: "g1", name: "Holiday", target: 8000, targetDate: "2027-06", source: "account", accountId: "a2" }, { id: "g2", name: "Cushion", target: 20000, startAmount: 3500, source: "budget" }],
    importRules: names.map((n, i) => ({ id: `ir${i}`, match: n.toLowerCase(), category: categories[i].name })),
    reminders: { enabled: true, leadDays: 3 }, savingsGoal: { monthly: 500 },
  }));
}

const LIMIT_MS = 500;

// Runs fn and returns how long it took, in milliseconds.
const time = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0; };

describe("five years of data", () => {
  let data;
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(TODAY); data = fiveYears(); });
  afterAll(() => vi.useRealTimers());

  it("has the size it claims", () => {
    const entries = Object.values(data.months).reduce((n, m) => n + m.expenses.length + m.recurring.length + m.upcoming.length + m.credits.length, 0);
    expect(Object.keys(data.months).length).toBe(61);
    expect(entries).toBeGreaterThan(10000);
  });

  it("saves and opens quickly", () => {
    let opened;
    expect(time(() => { opened = hydrate(migrate(JSON.parse(JSON.stringify(data)))); })).toBeLessThan(LIMIT_MS);
    expect(opened).toEqual(data);
  });

  it("totals every period quickly", () => {
    let total = 0;
    expect(time(() => {
      for (const [k, m] of Object.entries(data.months)) { total += periodSpending(m, k, TODAY, CUTOFF).total; periodIncome(m, k, TODAY, CUTOFF); }
    })).toBeLessThan(LIMIT_MS);
    expect(total).toBeGreaterThan(1e6);
  });

  it("works out every rollover budget quickly", () => {
    // Each carry is recomputed from the whole history, for every category.
    const spent = periodSpending(data.months[CUR], CUR, TODAY, CUTOFF).byCategory;
    const carries = [];
    expect(time(() => {
      for (const c of data.categories) carries.push(envelope(data, c, CUR, TODAY, spent.get(c.name) || 0)?.carry || 0);
    })).toBeLessThan(LIMIT_MS);
    expect(carries.some((c) => c !== 0)).toBe(true);
  });

  it("searches everything quickly", () => {
    const counts = [];
    expect(time(() => {
      counts.push(search(data, { text: "biedronka" }).count);
      counts.push(search(data, { min: 100, max: 200 }).count);
      counts.push(search(data, { category: "Category 3", text: "krakow" }).count);
    })).toBeLessThan(LIMIT_MS);
    expect(counts.every((n) => n > 0)).toBe(true);
  });

  it("builds an all-time report quickly", () => {
    let report;
    expect(time(() => { report = buildReport(data, rangeKeys(data, "all", CUR), TODAY, { runningKey: CUR }); })).toBeLessThan(LIMIT_MS);
    expect(report.periods.length).toBeGreaterThan(50);
  });

  it("forecasts the running period quickly", () => {
    let days;
    expect(time(() => { forecast(data, CUR, TODAY); balanceHistory(data, CUR, TODAY); days = spendingByDay(data, CUR, TODAY); })).toBeLessThan(LIMIT_MS);
    expect(days.length).toBeGreaterThan(0);
  });

  it("looks for regular payments quickly", () => {
    expect(time(() => findRegularPayments(data, TODAY))).toBeLessThan(LIMIT_MS);
  });

  it("works out goals quickly", () => {
    let history;
    expect(time(() => { history = leftOverHistory(data, TODAY); goalsMonthlyNeed(data.goals, data, TODAY, history); })).toBeLessThan(LIMIT_MS);
    expect(history.monthsCounted).toBeGreaterThan(50);
  });

  it("checks a 300-line statement against five years quickly", () => {
    const rnd = random(7);
    const rows = Array.from({ length: 300 }, (_, i) => ({
      date: `2026-09-${String(10 + (i % 20)).padStart(2, "0")}`, name: `BIEDRONKA ${i} KRAKOW`, note: "", amount: -Math.round(rnd() * 30000) / 100,
    }));
    let analysed;
    expect(time(() => { analysed = analyzeImport(rows, data); })).toBeLessThan(LIMIT_MS);
    expect(analysed.length).toBe(300);
  });
});
