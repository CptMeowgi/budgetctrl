import { currentMonthKey, monthKey, periodKeyFor } from "./lib/periods.js";
import { calendarFor } from "./lib/calendar.js";
import { isRecurringItem, isWeekly, missingCopies } from "./lib/occurrences.js";
import { migrateGoals } from "./lib/goals.js";
import { DEFAULT_CREDIT_CATEGORIES } from "./lib/setup.js";
import { detectCurrency } from "./money.js";
import { storedCatName } from "./text.js";

const CATEGORY_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#0066cc", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const CATEGORY_ICONS = ["🍔", "🚗", "🛍️", "📄", "🎮", "💊", "💰", "🏠", "✈️", "🎁", "☕", "📱"];
export const UNCATEGORIZED = { name: "Uncategorized", color: "#9ca3af", icon: "·" };
// Wider than the auto-assignment palettes above, so a hand-picked style is not
// limited to what new categories cycle through.
export const PICKER_COLORS = [...CATEGORY_COLORS, "#06b6d4", "#84cc16", "#a855f7", "#64748b", "#e11d48", "#0ea5e9"];
export const PICKER_ICONS = [...CATEGORY_ICONS, "🎓", "🐾", "💡", "🏋️", "🍷", "🧾", "💳", "🚌", "👶", "🎵", "🛠️", "💼"];

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
    savingsGoal: { monthly: 0 },
    goals: [],
    currency: detectCurrency(),
    locale: "",
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

// A name typed in the reader's language finds the built-in category it
// translates ("Zakupy spożywcze" is "Groceries") rather than adding a copy.
export function ensureCategory(categories, name) {
  const trimmed = normalizeCatName(storedCatName(name, categories));
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
  const trimmed = normalizeCatName(storedCatName(name, categories));
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
  // To the cent: the set-aside is kept per month, and a fortnight's figure
  // converted to a month has cents.
  const clean = (n) => (Number.isFinite(+n) && +n > 0 ? Math.round(+n * 100) / 100 : 0);
  if (g && typeof g === "object") {
    return { ...data, savingsGoal: { monthly: clean(g.monthly), target: clean(g.target) } };
  }
  const pct = Number(data.savingsGoalPercent) || 0;
  const income = data.months?.[calendarFor(data).current()]?.income || 0;
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

// When the payday changes, a monthly copy stays in its period and falls on
// its day of the month there. Everything with a date of its own, weekly
// copies included, moves to the period that date falls in - but never past
// the running period, which `today` decides under the new payday. A later
// period hasn't begun: made now, it would hold only what moved, and since a
// period that exists is never filled in again, it would begin with income 0
// and none of its bills. So a weekly copy dated there is left to its
// template, which makes it when that period begins, along with the period's
// other bills and its income. Anything else stays in the running period, as
// when it is added there today - or in a later period it is already in.
const staysPut = (x) => isRecurringItem(x) && !isWeekly(x);

// The period an entry of period `k` belongs in under the new payday, or
// null for a weekly copy left to its template.
function placement(newCutoff, today) {
  const runningKey = periodKeyFor(today, newCutoff);
  const placeOf = (x, k, date) => {
    if (staysPut(x)) return k;
    const to = periodKeyFor(date, newCutoff) || k;
    if (to <= runningKey || to === k) return to;
    if (isWeekly(x)) return null;
    return k > runningKey ? k : runningKey;
  };
  return { runningKey, placeOf };
}

export function countRebucketMoves(data, newCutoff, today = new Date()) {
  const { placeOf } = placement(newCutoff, today);
  let moves = 0;
  for (const [k, m] of Object.entries(data.months)) {
    for (const e of (m.expenses || [])) if (placeOf(e, k, e.date) !== k) moves++;
    for (const r of (m.recurring || [])) if (placeOf(r, k, r.date) !== k) moves++;
    for (const c of (m.credits || [])) if (placeOf(c, k, c.date) !== k) moves++;
    for (const u of (m.upcoming || [])) if (placeOf(u, k, u.dueDate) !== k) moves++;
  }
  return moves;
}

// The new payday can make a period the running one before it began (25th to
// 10th on 14 Oct starts the period of 10 Oct at once). Entries dated in it
// move there, and it starts as any period does: income carried over and the
// bills and credits that fall in it.
export function rebucketData(data, newCutoff, today = new Date()) {
  const { runningKey, placeOf } = placement(newCutoff, today);
  const out = {};
  const ensure = (k) => {
    if (!out[k]) out[k] = emptyMonth();
    return out[k];
  };
  for (const [k, m] of Object.entries(data.months)) {
    // A period keeps its own fields, such as when it was edited after it
    // closed; only its entries are dealt out again.
    const { expenses, recurring, upcoming, credits } = ensure(k);
    out[k] = { ...m, income: m.income || 0, expenses, recurring, upcoming, credits };
    for (const e of (m.expenses || [])) ensure(placeOf(e, k, e.date)).expenses.push(e);
    for (const r of (m.recurring || [])) {
      const to = placeOf(r, k, r.date);
      if (to) ensure(to).recurring.push(r);
    }
    for (const c of (m.credits || [])) {
      const to = placeOf(c, k, c.date);
      if (to) ensure(to).credits.push(c);
    }
    for (const u of (m.upcoming || [])) ensure(placeOf(u, k, u.dueDate)).upcoming.push(u);
  }
  if (out[runningKey] && !data.months[runningKey]) {
    out[runningKey] = startPeriod(data, calendarFor({ ...data, cutoffDay: newCutoff }), runningKey, out[runningKey]);
  }
  return { ...data, months: out };
}

export function migrate(raw) {
  if (!raw || typeof raw !== "object") return defaultData();
  // A months table means the current format, whatever else is missing -
  // hydrate() fills the gaps. Only the original flat format is rebuilt;
  // rebuilding anything else would throw its months away.
  if (raw.months && typeof raw.months === "object") return raw;
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
    migrateGoals(migrateSavingsGoal(
    migrateReminders(
    migrateCreditCategories(
      migrateTemplateIds(
        migrateCredits(
          migrateCategories(
            ensureCurrentMonth(
              migrateCutoff(data)))))))), uid)));
}

export function ensureCurrentMonth(data) {
  const cal = calendarFor(data);
  const cur = cal.current();
  if (data.months[cur]) return data;
  return { ...data, months: { ...data.months, [cur]: startPeriod(data, cal, cur) } };
}

// A period as it begins: income carried over from the latest earlier period,
// and a copy of each recurring bill and credit that falls in it. `already`
// is what's in it before it begins (entries a payday change moved there);
// copies among it count, so none is made twice.
export function startPeriod(data, cal, key, already = emptyMonth()) {
  const priorKeys = Object.keys(data.months).filter((k) => k < key).sort();
  const lastKey = priorKeys[priorKeys.length - 1];
  return {
    ...already,
    income: lastKey ? (data.months[lastKey].income || 0) : 0,
    // Only bills that fall in this period - a yearly bill is copied into one
    // period in twelve. Items saved before frequencies existed are monthly.
    // A weekly item gets a dated copy for each date it falls on.
    recurring: [...already.recurring, ...(data.recurringTemplate || []).flatMap((r) => missingCopies(r, cal, key, already.recurring, uid))],
    credits: [...already.credits, ...(data.creditTemplate || []).flatMap((c) => missingCopies(c, cal, key, already.credits, uid))],
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
