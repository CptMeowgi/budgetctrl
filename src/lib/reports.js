// Reports over a range of budget periods: totals, how each category moved over
// time, what changed against a comparable earlier range, and where the money
// went. Everything is built from periodSpending / periodIncome, so a report can
// never disagree with the Dashboard about a period.

import { periodSpending, periodIncome } from "./totals.js";
import { addMonths } from "./schedule.js";
import { monthLabel } from "./periods.js";
import { csvDialect, csvEscape, guardText, formatAmount } from "./csv.js";

export const BASE_INCOME_NAME = "Base income";

// "months" when periods are calendar months, "periods" when a custom start day
// makes them straddle two.
export function periodNoun(cutoffDay, n = 2) {
  const word = (cutoffDay || 1) === 1 ? "month" : "period";
  return n === 1 ? word : `${word}s`;
}

// Range ids are plain strings so they can sit in a <select>:
// "year:2026", "last:6", "all". Future periods are never part of a report -
// they hold plans, not history.
export function rangeOptions(data, curKey) {
  const keys = Object.keys(data.months || {}).filter((k) => k <= curKey);
  const closed = keys.filter((k) => k < curKey).length;
  const noun = periodNoun(data.cutoffDay);
  const curYear = curKey.slice(0, 4);
  const years = [...new Set(keys.map((k) => k.slice(0, 4)))].sort().reverse();
  const out = [];
  for (const y of years) out.push({ id: `year:${y}`, label: y === curYear ? `This year (${y})` : y });
  // Only offer a longer window when it would show more than the shorter one.
  if (closed >= 1) out.push({ id: "last:3", label: `Last 3 ${noun}` });
  if (closed > 3) out.push({ id: "last:6", label: `Last 6 ${noun}` });
  if (closed > 6) out.push({ id: "last:12", label: `Last 12 ${noun}` });
  if (years.length > 1) out.push({ id: "all", label: "All time" });
  return out;
}

function parseRange(rangeId) {
  const [kind, arg] = String(rangeId || "").split(":");
  if (kind === "year" && /^\d{4}$/.test(arg)) return { kind, year: arg };
  if (kind === "last" && Number(arg) > 0) return { kind, n: Number(arg) };
  if (kind === "all") return { kind };
  return null;
}

// The periods a range covers that actually hold data, oldest first. "Last N"
// means the N periods before this one: the current period is still running,
// and a half-finished month makes every average and comparison look better
// than it is.
export function rangeKeys(data, rangeId, curKey) {
  const r = parseRange(rangeId);
  const all = Object.keys(data.months || {}).filter((k) => k <= curKey).sort();
  if (!r) return [];
  if (r.kind === "year") return all.filter((k) => k.startsWith(`${r.year}-`));
  if (r.kind === "last") {
    const from = addMonths(curKey, -r.n);
    return all.filter((k) => k >= from && k < curKey);
  }
  return all;
}

// "Aug–Sep 2025", "Nov 2024–Feb 2025", "Mar 2025".
export function spanLabel(keys) {
  if (!keys.length) return "";
  const mon = (k) => monthLabel(k).slice(0, 3);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (first === last) return `${mon(first)} ${first.slice(0, 4)}`;
  if (first.slice(0, 4) === last.slice(0, 4)) return `${mon(first)}–${mon(last)} ${first.slice(0, 4)}`;
  return `${mon(first)} ${first.slice(0, 4)}–${mon(last)} ${last.slice(0, 4)}`;
}

// What a range is fairly compared against: the same periods a year earlier for
// a year, the N before for "last N", nothing for all time. Only completed
// periods on both sides - this October so far against all of last October is
// not a comparison.
export function comparisonFor(data, rangeId, curKey) {
  const r = parseRange(rangeId);
  if (!r || r.kind === "all") return null;
  const closed = rangeKeys(data, rangeId, curKey).filter((k) => k < curKey);
  const shift = r.kind === "year" ? 12 : r.n;
  const keys = closed.map((k) => addMonths(k, -shift)).filter((k) => data.months?.[k]);
  if (!closed.length || !keys.length) return null;
  // Say exactly what is compared when the earlier stretch was only partly
  // tracked - "vs 2025" would claim a whole year that isn't there.
  const complete = keys.length === closed.length;
  const label = !complete ? spanLabel(keys)
    : r.kind === "year" ? String(Number(r.year) - 1)
    : `the ${r.n} ${periodNoun(data.cutoffDay, r.n)} before`;
  return { closed, keys, label };
}

const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);

// Payee names from bank statements carry store numbers, dates and card digits:
// "BIEDRONKA 1234 WARSZAWA" and "Biedronka 77 Warszawa" are one shop.
export function payeeKey(name) {
  const key = String(name || "").toLowerCase().replace(/[\d#*/\\.,:;_|-]+/g, " ").replace(/\s+/g, " ").trim();
  return key || String(name || "").toLowerCase().trim();
}

// `runningKey` is the period still in progress. It counts toward totals but not
// averages, which are over completed periods whenever there are any.
export function buildReport(data, keys, today, { runningKey } = {}) {
  const cutoffDay = data.cutoffDay || 1;
  const periods = keys.map((key) => ({
    key,
    spending: periodSpending(data.months[key], key, today, cutoffDay),
    income: periodIncome(data.months[key], key, today, cutoffDay),
  }));
  const income = sum(periods, (p) => p.income.total);
  const spent = sum(periods, (p) => p.spending.total);

  const averaged = keys.filter((k) => k !== runningKey);
  const use = averaged.length ? averaged : keys;
  const averageOf = (perPeriod) => (use.length ? perPeriod.filter((_, i) => use.includes(keys[i])).reduce((a, v) => a + v, 0) / use.length : 0);

  const rows = new Map();
  periods.forEach((p, i) => {
    for (const [name, v] of p.spending.byCategory) {
      if (!rows.has(name)) rows.set(name, { name, total: 0, perPeriod: new Array(periods.length).fill(0) });
      const row = rows.get(name);
      row.perPeriod[i] += v;
      row.total += v;
    }
  });
  const categories = [...rows.values()]
    .map((r) => ({ ...r, average: averageOf(r.perPeriod) }))
    .sort((a, b) => b.total - a.total);

  const sources = new Map();
  const base = sum(periods, (p) => p.income.base);
  if (base) sources.set(BASE_INCOME_NAME, base);
  for (const p of periods) for (const [name, v] of p.income.bySource) sources.set(name, (sources.get(name) || 0) + v);

  const counted = periods.flatMap((p) => p.spending.items.map((it) => ({ ...it, periodKey: p.key })));
  // One-off spending only: rent is the biggest payment every month, and listing
  // it twelve times says nothing.
  const biggest = counted
    .filter((it) => it.kind !== "recurring")
    .sort((a, b) => (b.entry.amount || 0) - (a.entry.amount || 0))
    .slice(0, 8);

  const payeeMap = new Map();
  for (const it of counted) {
    const k = payeeKey(it.entry.name);
    if (!k) continue;
    const p = payeeMap.get(k) || { key: k, total: 0, count: 0, spellings: new Map() };
    p.total += it.entry.amount || 0;
    p.count += 1;
    const spelling = String(it.entry.name).trim();
    p.spellings.set(spelling, (p.spellings.get(spelling) || 0) + 1);
    payeeMap.set(k, p);
  }
  const payees = [...payeeMap.values()]
    .map(({ key, total, count, spellings }) => ({
      key, total, count,
      // Shown as it was most often written, not as the lowercased grouping key.
      name: [...spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  return {
    keys,
    income,
    spent,
    saved: income - spent,
    savingsRate: income > 0 ? (income - spent) / income : null,
    averagedOver: use.length,
    averageSpent: averageOf(periods.map((p) => p.spending.total)),
    averageIncome: averageOf(periods.map((p) => p.income.total)),
    averageSaved: averageOf(periods.map((p) => p.income.total - p.spending.total)),
    periods: periods.map((p) => ({ key: p.key, income: p.income.total, spent: p.spending.total })),
    categories,
    incomeSources: [...sources.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    biggest,
    payees,
  };
}

// Per-period averages, so a range with fewer tracked periods compares fairly.
// Largest moves first, in either direction.
export function categoryChanges(now, before) {
  const avg = (report, name) => {
    const row = report.categories.find((c) => c.name === name);
    return row && report.keys.length ? row.total / report.keys.length : 0;
  };
  const names = new Set([...now.categories, ...before.categories].map((c) => c.name));
  return [...names]
    .map((name) => {
      const a = avg(now, name);
      const b = avg(before, name);
      return { name, now: a, before: b, delta: a - b, pct: b > 0 ? (a - b) / b : null };
    })
    .filter((c) => Math.abs(c.delta) >= 0.005)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

export function percentChange(now, before) {
  return before > 0 ? (now - before) / before : null;
}

// Category by period, as it is on screen, for a spreadsheet. Numbers are
// written in the reader's own decimal style, like the transaction export.
export function reportToCsv(report, { locale, label = (k) => k, bom = true } = {}) {
  const { delimiter, decimal } = csvDialect(locale);
  const money = (n) => formatAmount(n, decimal);
  const line = (cells) => cells.map((c) => csvEscape(c, delimiter)).join(delimiter);
  const lines = [line(["Category", ...report.keys.map(label), "Total", "Average"])];
  for (const c of report.categories) {
    lines.push(line([guardText(c.name), ...c.perPeriod.map(money), money(c.total), money(c.average)]));
  }
  lines.push(line(["Total spent", ...report.periods.map((p) => money(p.spent)), money(report.spent), money(report.averageSpent)]));
  lines.push(line(["Income", ...report.periods.map((p) => money(p.income)), money(report.income), money(report.averageIncome)]));
  lines.push(line(["Saved", ...report.periods.map((p) => money(p.income - p.spent)), money(report.saved), money(report.averageSaved)]));
  return (bom ? "\uFEFF" : "") + lines.join("\r\n") + "\r\n";
}
