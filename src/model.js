import { currentMonthKey, currentPeriodKey, monthKey, monthLabel, periodKeyFor } from "./lib/periods.js";
import { isOnCycle } from "./lib/schedule.js";
import { periodIncome, periodSpending } from "./lib/totals.js";
import { detectCurrency } from "./money.js";

const CATEGORY_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#0066cc", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const CATEGORY_ICONS = ["🍔", "🚗", "🛍️", "📄", "🎮", "💊", "💰", "🏠", "✈️", "🎁", "☕", "📱"];
export const UNCATEGORIZED = { name: "Uncategorized", color: "#9ca3af", icon: "·" };
// Wider than the auto-assignment palettes above, so a hand-picked style is not
// limited to what new categories cycle through.
export const PICKER_COLORS = [...CATEGORY_COLORS, "#06b6d4", "#84cc16", "#a855f7", "#64748b", "#e11d48", "#0ea5e9"];
export const PICKER_ICONS = [...CATEGORY_ICONS, "🎓", "🐾", "💡", "🏋️", "🍷", "🧾", "💳", "🚌", "👶", "🎵", "🛠️", "💼"];

const DEFAULT_CREDIT_CATEGORIES = [
  { name: "Refund", color: "#10b981", icon: "↩" },
  { name: "Gift",   color: "#ec4899", icon: "🎁" },
  { name: "Bonus",  color: "#f59e0b", icon: "⭐" },
  { name: "Salary", color: "#0066cc", icon: "💼" },
  { name: "Other",  color: "#9ca3af", icon: "·" },
];
export const CREDIT_UNCATEGORIZED = { name: "Other", color: "#9ca3af", icon: "·" };

export const STORAGE_KEY = "budget-app-data";

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function emptyMonth() {
  return { income: 0, expenses: [], recurring: [], upcoming: [], credits: [] };
}

export function defaultData() {
  const cur = currentMonthKey();
  return {
    months: { [cur]: emptyMonth() },
    savingsGoal: { monthly: 0, target: 0 },
    currency: detectCurrency(),
    locale: "",
    startingBalance: 0,
    cutoffDay: 1,
    recurringTemplate: [],
    creditTemplate: [],
    categories: [{ ...UNCATEGORIZED }],
    creditCategories: DEFAULT_CREDIT_CATEGORIES.map((c) => ({ ...c })),
    accounts: [],
  };
}

function normalizeCatName(name) {
  return (name || "").trim();
}

export function findCategory(categories, name) {
  const n = normalizeCatName(name).toLowerCase();
  if (!n) return null;
  return categories.find((c) => c.name.toLowerCase() === n) || null;
}

export function ensureCategory(categories, name) {
  const trimmed = normalizeCatName(name);
  if (!trimmed) return { categories, category: UNCATEGORIZED };
  const existing = findCategory(categories, trimmed);
  if (existing) return { categories, category: existing };
  const userCats = categories.filter((c) => c.name !== "Uncategorized");
  const idx = userCats.length;
  const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
  const icon = CATEGORY_ICONS[idx % CATEGORY_ICONS.length];
  const newCat = { name: trimmed, color, icon };
  return { categories: [...categories, newCat], category: newCat };
}

function findCreditCategory(categories, name) {
  const n = normalizeCatName(name).toLowerCase();
  if (!n) return null;
  return categories.find((c) => c.name.toLowerCase() === n) || null;
}

export function ensureCreditCategory(categories, name) {
  const trimmed = normalizeCatName(name);
  if (!trimmed) return { categories, category: CREDIT_UNCATEGORIZED };
  const existing = findCreditCategory(categories, trimmed);
  if (existing) return { categories, category: existing };
  const idx = categories.length;
  const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
  const icon = CATEGORY_ICONS[idx % CATEGORY_ICONS.length];
  const newCat = { name: trimmed, color, icon };
  return { categories: [...categories, newCat], category: newCat };
}

function migrateCategories(data) {
  const categories = Array.isArray(data.categories) ? [...data.categories] : [];
  if (!categories.find((c) => c.name === "Uncategorized")) {
    categories.unshift({ ...UNCATEGORIZED });
  }
  const months = { ...data.months };
  for (const key of Object.keys(months)) {
    const m = months[key];
    const fix = (arr) => arr.map((e) => e.category ? e : { ...e, category: "Uncategorized" });
    months[key] = {
      ...m,
      expenses: fix(m.expenses || []),
      recurring: fix(m.recurring || []),
      upcoming: fix(m.upcoming || []),
    };
  }
  const template = (data.recurringTemplate || []).map((r) => r.category ? r : { ...r, category: "Uncategorized" });
  return { ...data, months, recurringTemplate: template, categories };
}

function migrateCredits(data) {
  const months = { ...data.months };
  for (const key of Object.keys(months)) {
    const m = months[key];
    if (!Array.isArray(m.credits)) {
      months[key] = { ...m, credits: [] };
    }
  }
  return { ...data, months };
}

function migrateTemplateIds(data) {
  const template = data.recurringTemplate || [];
  if (template.length === 0) return data;
  const months = { ...data.months };
  for (const key of Object.keys(months)) {
    const m = months[key];
    const recurring = (m.recurring || []).map((r) => {
      if (r.templateId) return r;
      const match = template.find((t) => t.name === r.name && t.amount === r.amount);
      return match && match.id ? { ...r, templateId: match.id } : r;
    });
    months[key] = { ...m, recurring };
  }
  return { ...data, months };
}

function migrateCreditCategories(data) {
  const creditCategories = Array.isArray(data.creditCategories) && data.creditCategories.length
    ? [...data.creditCategories]
    : DEFAULT_CREDIT_CATEGORIES.map((c) => ({ ...c }));
  const byLower = new Map(creditCategories.map((c) => [c.name.toLowerCase(), c.name]));
  const months = { ...data.months };
  for (const key of Object.keys(months)) {
    const m = months[key];
    const credits = (m.credits || []).map((c) => {
      if (c.category) return c;
      const mapped = byLower.get((c.source || "").trim().toLowerCase());
      return { ...c, category: mapped || "Other" };
    });
    months[key] = { ...m, credits };
  }
  return { ...data, months, creditCategories, creditTemplate: data.creditTemplate || [] };
}

function migrateCutoff(data) {
  const cd = Number(data.cutoffDay);
  return { ...data, cutoffDay: (cd >= 1 && cd <= 28) ? cd : 1 };
}

// The goal used to be a percentage of income. It is now two concrete sums: what
// you mean to set aside each period, and the total you are saving up to. The old
// percentage is converted against current income so an existing goal survives.
// Existing installs keep PLN, which is what every figure in them was entered
// and displayed as. Only a fresh install guesses from the system locale.
function migrateCurrency(data) {
  if (typeof data.currency === "string" && data.currency.length === 3) {
    return typeof data.locale === "string" ? data : { ...data, locale: "" };
  }
  // Existing installs keep both the currency and the pl-PL number formatting
  // that was hardcoded before, so upgrading changes nothing on screen. Only a
  // fresh install follows the system.
  const existing = Object.keys(data.months || {}).length > 0;
  return existing
    ? { ...data, currency: "PLN", locale: "pl-PL" }
    : { ...data, currency: detectCurrency(), locale: "" };
}

function migrateSavingsGoal(data) {
  const g = data.savingsGoal;
  const clean = (n) => (Number.isFinite(+n) && +n > 0 ? Math.round(+n) : 0);
  if (g && typeof g === "object") {
    return { ...data, savingsGoal: { monthly: clean(g.monthly), target: clean(g.target) } };
  }
  const pct = Number(data.savingsGoalPercent) || 0;
  const income = data.months?.[currentPeriodKey(data.cutoffDay || 1)]?.income || 0;
  const { savingsGoalPercent: _dropped, ...rest } = data;
  return { ...rest, savingsGoal: { monthly: clean((income * pct) / 100), target: 0 } };
}

function migrateReminders(data) {
  const r = data.reminders || {};
  const lead = Number(r.leadDays);
  return {
    ...data,
    reminders: {
      enabled: r.enabled !== false,
      leadDays: (lead >= 0 && lead <= 30) ? lead : 3,
    },
  };
}

export function countRebucketMoves(data, newCutoff) {
  let moves = 0;
  for (const [k, m] of Object.entries(data.months)) {
    for (const e of (m.expenses || [])) if ((periodKeyFor(e.date, newCutoff) || k) !== k) moves++;
    for (const c of (m.credits || [])) if (c.dayOfMonth == null && (periodKeyFor(c.date, newCutoff) || k) !== k) moves++;
    for (const u of (m.upcoming || [])) if ((periodKeyFor(u.dueDate, newCutoff) || k) !== k) moves++;
  }
  return moves;
}

export function rebucketData(data, newCutoff) {
  const out = {};
  const ensure = (k) => {
    if (!out[k]) out[k] = { income: 0, expenses: [], recurring: [], upcoming: [], credits: [] };
    return out[k];
  };
  for (const [k, m] of Object.entries(data.months)) {
    const home = ensure(k);
    home.income = m.income || 0;
    home.recurring = [...home.recurring, ...(m.recurring || [])];
    for (const e of (m.expenses || [])) ensure(periodKeyFor(e.date, newCutoff) || k).expenses.push(e);
    for (const c of (m.credits || [])) {
      if (c.dayOfMonth != null) home.credits.push(c);
      else ensure(periodKeyFor(c.date, newCutoff) || k).credits.push(c);
    }
    for (const u of (m.upcoming || [])) ensure(periodKeyFor(u.dueDate, newCutoff) || k).upcoming.push(u);
  }
  return { ...data, months: out };
}

export function migrate(raw) {
  if (!raw || typeof raw !== "object") return defaultData();
  if (raw.months && raw.recurringTemplate) return raw;
  const cur = currentMonthKey();
  const months = {};
  const oldExpenses = Array.isArray(raw.expenses) ? raw.expenses : [];
  const oldUpcoming = Array.isArray(raw.upcoming) ? raw.upcoming : [];
  const oldRecurring = Array.isArray(raw.recurring) ? raw.recurring : [];

  months[cur] = emptyMonth();
  months[cur].income = Number(raw.monthlyIncome) || 0;
  months[cur].recurring = oldRecurring.map((r) => ({ ...r }));

  for (const e of oldExpenses) {
    const k = monthKey(e.date) || cur;
    if (!months[k]) months[k] = emptyMonth();
    months[k].expenses.push(e);
  }
  for (const u of oldUpcoming) {
    const k = monthKey(u.dueDate) || cur;
    if (!months[k]) months[k] = emptyMonth();
    months[k].upcoming.push(u);
  }

  return {
    months,
    recurringTemplate: oldRecurring.map((r) => ({ ...r })),
  };
}

// Single hydration pipeline. Every entry point - load, import, reset - goes
// through here so a new migrator is added in exactly one place. This used to be
// a six-deep nest repeated at four call sites, and extending it dropped a
// closing paren on all four.
function migrateAccounts(data) {
  return Array.isArray(data.accounts) ? data : { ...data, accounts: [] };
}

export function hydrate(data) {
  return migrateAccounts(
    migrateCurrency(
    migrateSavingsGoal(
    migrateReminders(
    migrateCreditCategories(
      migrateTemplateIds(
        migrateCredits(
          migrateCategories(
            ensureCurrentMonth(
              migrateCutoff(data))))))))));
}

export function ensureCurrentMonth(data) {
  const cur = currentPeriodKey(data.cutoffDay || 1);
  if (data.months[cur]) return data;
  const priorKeys = Object.keys(data.months).filter((k) => k < cur).sort();
  const lastKey = priorKeys[priorKeys.length - 1];
  const carriedIncome = lastKey ? (data.months[lastKey].income || 0) : 0;
  return {
    ...data,
    months: {
      ...data.months,
      [cur]: {
        income: carriedIncome,
        expenses: [],
        // Only bills that fall in this period - a yearly bill is copied into one
        // period in twelve. Items saved before frequencies existed are monthly.
        recurring: (data.recurringTemplate || []).filter((r) => isOnCycle(r, cur)).map((r) => ({ ...r, id: uid(), templateId: r.id })),
        upcoming: [],
        credits: (data.creditTemplate || []).filter((c) => isOnCycle(c, cur)).map((c) => ({ ...c, id: uid(), templateId: c.id })),
      },
    },
  };
}

// A donut's view of periodSpending's byCategory: same totals, decorated and
// ranked. Never aggregate separately - see lib/totals.js for what drifted.
export function categoryBreakdown(byCategory, categories) {
  return Array.from(byCategory.entries()).map(([name, value]) => {
    const cat = categories.find((c) => c.name === name) || { color: "#9ca3af", icon: "·" };
    return { name, value, color: cat.color, icon: cat.icon };
  }).sort((a, b) => b.value - a.value);
}

export function cumulativeSavings(data, today) {
  const cutoffDay = data.cutoffDay || 1;
  const cur = currentPeriodKey(cutoffDay);
  const keys = Object.keys(data.months).filter((k) => k < cur).sort();
  let total = data.startingBalance || 0;
  const series = [{ key: "start", label: "Start", balance: total, delta: 0, income: 0, spent: 0 }];
  for (const k of keys) {
    const m = data.months[k];
    const income = periodIncome(m, k, today, cutoffDay).total;
    const spent = periodSpending(m, k, today, cutoffDay).total;
    const delta = income - spent;
    total += delta;
    series.push({ key: k, label: monthLabel(k).slice(0, 3), balance: total, delta, income, spent, editedAt: m.editedAt || null });
  }
  return { total, series, monthsCounted: keys.length };
}
