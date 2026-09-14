if (!window.storage) {
  window.storage = {
    get: async (key) => {
      const val = localStorage.getItem(key);
      return val ? { value: val } : null;
    },
    set: async (key, value) => {
      localStorage.setItem(key, value);
      return { key, value };
    },
  };
}
import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer, XAxis, YAxis, CartesianGrid, BarChart, Bar, AreaChart, Area } from "recharts";

// ---- Apple design tokens -------------------------------------------------
// Transcribed from the Apple DESIGN.md spec. Kept as tokens rather than inlined
// so the scale is enforced instead of approximated per component.

// SF Pro where the platform has it (macOS/iOS), DM Sans elsewhere - the app
// already loads DM Sans and SF Pro is not licensable for web delivery.
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'DM Sans', 'Segoe UI', sans-serif";

// Weight ladder is 300/400/600/700. 500 is deliberately absent from the spec.
const TYPE = {
  displayLarge:  { fontSize: 40, fontWeight: 600, lineHeight: 1.10, letterSpacing: "0" },
  displayMedium: { fontSize: 34, fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.374px" },
  lead:          { fontSize: 28, fontWeight: 400, lineHeight: 1.14, letterSpacing: "0.196px" },
  leadAiry:      { fontSize: 24, fontWeight: 300, lineHeight: 1.5,  letterSpacing: "0" },
  tagline:       { fontSize: 21, fontWeight: 600, lineHeight: 1.19, letterSpacing: "0.231px" },
  bodyStrong:    { fontSize: 17, fontWeight: 600, lineHeight: 1.24, letterSpacing: "-0.374px" },
  body:          { fontSize: 17, fontWeight: 400, lineHeight: 1.47, letterSpacing: "-0.374px" },
  caption:       { fontSize: 14, fontWeight: 400, lineHeight: 1.43, letterSpacing: "-0.224px" },
  captionStrong: { fontSize: 14, fontWeight: 600, lineHeight: 1.29, letterSpacing: "-0.224px" },
  buttonLarge:   { fontSize: 18, fontWeight: 300, lineHeight: 1.0,  letterSpacing: "0" },
  buttonUtility: { fontSize: 14, fontWeight: 400, lineHeight: 1.29, letterSpacing: "-0.224px" },
  finePrint:     { fontSize: 12, fontWeight: 400, lineHeight: 1.0,  letterSpacing: "-0.12px" },
  microLegal:    { fontSize: 10, fontWeight: 400, lineHeight: 1.3,  letterSpacing: "-0.08px" },
  navLink:       { fontSize: 12, fontWeight: 400, lineHeight: 1.0,  letterSpacing: "-0.12px" },
};

const RADIUS = { none: 0, xs: 5, sm: 8, md: 11, lg: 18, pill: 9999 };
const SPACE = { xxs: 4, xs: 8, sm: 12, md: 17, lg: 24, xl: 32, xxl: 48, section: 80 };

// The spec allows exactly one drop shadow, reserved for floating surfaces.
// Cards get a hairline border instead - alternating surfaces act as dividers.
const ELEVATION = "rgba(0, 0, 0, 0.22) 3px 5px 30px 0";
const FOCUS_BLUE = "#0071e3";
const CHIP_GRAY = "rgba(210, 210, 215, 0.64)";

const THEME = {
  bg: "#f5f5f7",          // Parchment
  surface: "#ffffff",     // Pure White
  border: "#e0e0e0",      // Hairline
  text: "#1d1d1f",        // Near-Black Ink
  textMuted: "#333333",   // Ink Muted 80
  textFaint: "#7a7a7a",   // Ink Muted 48
  accent: "#0066cc",      // Action Blue - the single accent
  accentSoft: "rgba(0,102,204,0.08)",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  shadowCard: "none",
  outerBg: "#000000",
  outerText: "#ffffff",
  outerTextMuted: "#cccccc",
  outerBorder: "#2a2a2c",
  outerAccentSoft: "rgba(41,151,255,0.15)",
};

// Full light theme — inner panel light AND outer frame light.
const LIGHT_THEME = {
  ...THEME,
  outerBg: "#ffffff",
  outerText: "#1d1d1f",
  outerTextMuted: "#7a7a7a",
  outerBorder: "#e0e0e0",
  outerAccentSoft: "rgba(0,102,204,0.08)",
};

// Full dark theme — everything dark.
const DARK_THEME = {
  ...LIGHT_THEME,
  // Global-nav black frame, near-black tiles for content and cards.
  outerBg: "#000000",
  outerText: "#ffffff",
  outerTextMuted: "#cccccc",
  outerBorder: "#2a2a2c",
  outerAccentSoft: "rgba(41,151,255,0.18)",
  bg: "#1d1d1f",
  surface: "#272729",     // Near-Black Tile 1
  border: "#3a3a3c",
  text: "#ffffff",
  textMuted: "#cccccc",   // Body Muted
  textFaint: "#8a8a8e",
  accent: "#2997ff",      // Sky Link Blue, for links on dark surfaces
  accentSoft: "rgba(41,151,255,0.18)",
  shadowCard: "none",
};

const CATEGORY_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#0066cc", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const CATEGORY_ICONS = ["🍔", "🚗", "🛍️", "📄", "🎮", "💊", "💰", "🏠", "✈️", "🎁", "☕", "📱"];
const UNCATEGORIZED = { name: "Uncategorized", color: "#9ca3af", icon: "·" };

const DEFAULT_CREDIT_CATEGORIES = [
  { name: "Refund", color: "#10b981", icon: "↩" },
  { name: "Gift",   color: "#ec4899", icon: "🎁" },
  { name: "Bonus",  color: "#f59e0b", icon: "⭐" },
  { name: "Salary", color: "#0066cc", icon: "💼" },
  { name: "Other",  color: "#9ca3af", icon: "·" },
];
const CREDIT_UNCATEGORIZED = { name: "Other", color: "#9ca3af", icon: "·" };

const STORAGE_KEY = "budget-app-data";
// Which tabs offer an "+ Add" CTA, what it is called, and which modal it opens.
// Previously three parallel inline ternaries in the header that had to be kept
// in sync by hand.
const ADD_LABELS = {
  expenses: "Expense",
  recurring: "Recurring",
  upcoming: "Payment",
};
const MODAL_FOR_TAB = { expenses: "expense" };

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "◉" },
  { id: "duesoon", label: "Due Soon", icon: "!" },
  { id: "expenses", label: "Expenses", icon: "↗" },
  { id: "recurring", label: "Recurring", icon: "↻" },
  { id: "upcoming", label: "Upcoming", icon: "◈" },
  { id: "credits", label: "Credits", icon: "+" },
  { id: "history", label: "History", icon: "◷" },
  { id: "year", label: "Year", icon: "▦" },
  { id: "savings", label: "Savings", icon: "◆" },
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmt(n) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(n);
}

function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonthKey() {
  return monthKey(new Date());
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function emptyMonth() {
  return { income: 0, expenses: [], recurring: [], upcoming: [], credits: [] };
}

function defaultData() {
  const cur = currentMonthKey();
  return {
    months: { [cur]: emptyMonth() },
    savingsGoal: { monthly: 0, target: 0 },
    startingBalance: 0,
    cutoffDay: 1,
    recurringTemplate: [],
    creditTemplate: [],
    categories: [{ ...UNCATEGORIZED }],
    creditCategories: DEFAULT_CREDIT_CATEGORIES.map((c) => ({ ...c })),
  };
}

function exportData(data) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `budget-ctrl-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function normalizeCatName(name) {
  return (name || "").trim();
}

function findCategory(categories, name) {
  const n = normalizeCatName(name).toLowerCase();
  if (!n) return null;
  return categories.find((c) => c.name.toLowerCase() === n) || null;
}

function ensureCategory(categories, name) {
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

function ensureCreditCategory(categories, name) {
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

function daysInCalMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

// A budget period is keyed by the calendar month it STARTS in. With a cutoff of
// 10, period "2026-09" runs 10 Sep - 9 Oct. Cutoff 1 collapses to calendar months.
function periodKeyFor(date, cutoffDay) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  let y = d.getFullYear();
  let m = d.getMonth();
  if (cutoffDay > 1 && d.getDate() < cutoffDay) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

function currentPeriodKey(cutoffDay) {
  return periodKeyFor(new Date(), cutoffDay || 1);
}

function periodRange(periodKey, cutoffDay) {
  const [y, m] = periodKey.split("-").map(Number);
  const cd = cutoffDay || 1;
  const start = new Date(y, m - 1, Math.min(cd, daysInCalMonth(y, m)));
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const endExclusive = new Date(nextY, nextM - 1, Math.min(cd, daysInCalMonth(nextY, nextM)));
  return { start, end: new Date(endExclusive.getTime() - 86400000) };
}

function periodLabel(periodKey, cutoffDay) {
  const primary = monthLabel(periodKey);
  if (!cutoffDay || cutoffDay <= 1) return { primary, range: null };
  const { start, end } = periodRange(periodKey, cutoffDay);
  const short = (d) => d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  return { primary, range: `${short(start)} – ${short(end)}` };
}

// Resolves which actual date inside the period a given dayOfMonth lands on.
// With cutoff 10 and period 2026-09: day 15 -> 15 Sep; day 5 -> 5 Oct.
function recurringDateInPeriod(dayOfMonth, periodKey, cutoffDay) {
  const { start, end } = periodRange(periodKey, cutoffDay);
  const day = Number(dayOfMonth || 1);
  const tryIn = (y, m1) => new Date(y, m1 - 1, Math.min(day, daysInCalMonth(y, m1)));
  let c = tryIn(start.getFullYear(), start.getMonth() + 1);
  if (c >= start && c <= end) return c;
  c = tryIn(end.getFullYear(), end.getMonth() + 1);
  if (c >= start && c <= end) return c;
  return start;
}

function isRecurringDue(r, periodKey, today, cutoffDay) {
  const { start, end } = periodRange(periodKey, cutoffDay || 1);
  if (today > end) return true;
  if (today < start) return false;
  return today >= recurringDateInPeriod(r.dayOfMonth, periodKey, cutoffDay || 1);
}

function countRebucketMoves(data, newCutoff) {
  let moves = 0;
  for (const [k, m] of Object.entries(data.months)) {
    for (const e of (m.expenses || [])) if ((periodKeyFor(e.date, newCutoff) || k) !== k) moves++;
    for (const c of (m.credits || [])) if (c.dayOfMonth == null && (periodKeyFor(c.date, newCutoff) || k) !== k) moves++;
    for (const u of (m.upcoming || [])) if ((periodKeyFor(u.dueDate, newCutoff) || k) !== k) moves++;
  }
  return moves;
}

function rebucketData(data, newCutoff) {
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

function spentByCategory(month, monthKey, today, cutoffDay) {
  const totals = new Map();
  const add = (name, amount) => {
    const key = name || UNCATEGORIZED.name;
    totals.set(key, (totals.get(key) || 0) + amount);
  };
  for (const e of (month.expenses || [])) add(e.category, e.amount);
  for (const r of (month.recurring || [])) {
    // Recurring only counts once its day has passed, matching the Remaining card.
    if (!today || isRecurringDue(r, monthKey, today, cutoffDay)) add(r.category, r.amount);
  }
  return totals;
}

function toggleSort(sorts, col, shiftKey) {
  const arr = sorts || [];
  const idx = arr.findIndex((s) => s.col === col);
  if (shiftKey) {
    if (idx === -1) return [...arr, { col, dir: "asc" }];
    const cur = arr[idx];
    if (cur.dir === "asc") {
      const next = [...arr];
      next[idx] = { col, dir: "desc" };
      return next;
    }
    return arr.filter((_, i) => i !== idx);
  }
  if (arr.length === 1 && arr[0].col === col) {
    if (arr[0].dir === "asc") return [{ col, dir: "desc" }];
    return [];
  }
  return [{ col, dir: "asc" }];
}

function filterAndSort(arr, view) {
  let out = arr;
  if (view.search) {
    const q = view.search.toLowerCase();
    out = out.filter((x) => (x.name || "").toLowerCase().includes(q));
  }
  const sorts = view.sorts || [];
  if (sorts.length > 0) {
    out = [...out].sort((a, b) => {
      for (const { col, dir } of sorts) {
        const av = a[col], bv = b[col];
        const cmp = (typeof av === "string" && typeof bv === "string")
          ? av.localeCompare(bv)
          : (av < bv ? -1 : av > bv ? 1 : 0);
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }
  return out;
}

function categoryAverage(data, categoryName, excludeKey) {
  const keys = Object.keys(data.months).filter((k) => k !== excludeKey);
  if (keys.length === 0) return null;
  let total = 0;
  for (const k of keys) {
    const m = data.months[k];
    for (const e of (m.expenses || [])) if (e.category === categoryName) total += e.amount;
    for (const r of (m.recurring || [])) if (r.category === categoryName) total += r.amount;
  }
  return total / keys.length;
}

function migrate(raw) {
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
function hydrate(data) {
  return migrateSavingsGoal(
    migrateReminders(
    migrateCreditCategories(
      migrateTemplateIds(
        migrateCredits(
          migrateCategories(
            ensureCurrentMonth(
              migrateCutoff(data))))))));
}

function ensureCurrentMonth(data) {
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
        recurring: (data.recurringTemplate || []).map((r) => ({ ...r, id: uid(), templateId: r.id })),
        upcoming: [],
        credits: (data.creditTemplate || []).map((c) => ({ ...c, id: uid(), templateId: c.id })),
      },
    },
  };
}

// The donut's view of spentByCategory: same totals, decorated and ranked. These
// were two separate aggregations that had already drifted once - only one of
// them bucketed uncategorised entries under the Uncategorized name.
function categoryBreakdown(month, categories, monthKey, today, cutoffDay) {
  const totals = spentByCategory(month, monthKey, today, cutoffDay);
  return Array.from(totals.entries()).map(([name, value]) => {
    const cat = categories.find((c) => c.name === name) || { color: "#9ca3af", icon: "·" };
    return { name, value, color: cat.color, icon: cat.icon };
  }).sort((a, b) => b.value - a.value);
}

function monthlyTotals(data) {
  const today = new Date();
  const cutoffDay = data.cutoffDay || 1;
  return Object.keys(data.months).sort().map((key) => {
    const m = data.months[key];
    const spentExpenses = (m.expenses || []).reduce((a, e) => a + e.amount, 0);
    const spentRecurring = (m.recurring || [])
      .filter((r) => isRecurringDue(r, key, today, cutoffDay))
      .reduce((a, e) => a + e.amount, 0);
    const credits = (m.credits || []).reduce((a, c) => a + c.amount, 0);
    return { key, label: monthLabel(key).slice(0, 3), spent: spentExpenses + spentRecurring, income: (m.income || 0) + credits };
  });
}

function cumulativeSavings(data) {
  const cur = currentPeriodKey(data.cutoffDay || 1);
  const keys = Object.keys(data.months).filter((k) => k < cur).sort();
  let total = data.startingBalance || 0;
  const series = [{ key: "start", label: "Start", balance: total, delta: 0, income: 0, spent: 0 }];
  for (const k of keys) {
    const m = data.months[k];
    const income = (m.income || 0) + (m.credits || []).reduce((a, c) => a + c.amount, 0);
    const spent = (m.expenses || []).reduce((a, e) => a + e.amount, 0)
                + (m.recurring || []).reduce((a, r) => a + r.amount, 0)
                + (m.upcoming || []).filter((u) => upcomingSettled(u)).reduce((a, u) => a + u.amount, 0);
    const delta = income - spent;
    total += delta;
    series.push({ key: k, label: monthLabel(k).slice(0, 3), balance: total, delta, income, spent, editedAt: m.editedAt || null });
  }
  return { total, series, monthsCounted: keys.length };
}

function Modal({ title, onClose, children }) {
  const { s } = useThemed();
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} style={s.closeBtn}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CategoryPicker({ value, onChange, categories }) {
  const { s } = useThemed();
  const [open, setOpen] = useState(false);
  const suggestions = categories.filter((c) => {
    if (c.name === "Uncategorized") return false;
    if (!value) return true;
    return c.name.toLowerCase().includes(value.toLowerCase());
  });
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        placeholder="e.g. Food, Transport"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={s.input}
      />
      {open && suggestions.length > 0 && (
        <div style={s.suggestBox}>
          {suggestions.map((c) => (
            <div key={c.name} style={s.suggestItem}
              onMouseDown={(e) => { e.preventDefault(); onChange(c.name); setOpen(false); }}>
              <span style={{ ...s.catDot, background: `${c.color}25` }}>{c.icon}</span>
              <span>{c.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormModal({ title, fields, onClose, onSave }) {
  const { theme, s } = useThemed();
  const [vals, setVals] = useState(() => {
    const init = {};
    fields.forEach((f) => { init[f.key] = f.type === "checkbox" ? !!f.defaultValue : (f.defaultValue || ""); });
    return init;
  });
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: fields.length > 3 ? "1fr 1fr" : "1fr", gap: 16, padding: "20px 0" }}>
        {fields.map((f) => (
          <div key={f.key} style={f.type === "checkbox" ? { gridColumn: "1 / -1" } : undefined}>
            {f.type !== "checkbox" && (
              <label style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 }}>{f.label}</label>
            )}
            {f.type === "checkbox" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "4px 0" }}>
                <input type="checkbox" checked={!!vals[f.key]}
                  onChange={(e) => setVals({ ...vals, [f.key]: e.target.checked })}
                  style={{ accentColor: theme.accent, width: 16, height: 16, cursor: "pointer" }} />
                <span>
                  <span style={{ ...TYPE.caption, color: theme.text }}>{f.label}</span>
                  {f.hint && <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, display: "block" }}>{f.hint}</span>}
                </span>
              </label>
            ) : f.type === "select" ? (
              <select value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} style={s.input}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "category" ? (
              <CategoryPicker value={vals[f.key] || ""} onChange={(v) => setVals({ ...vals, [f.key]: v })} categories={f.categories} />
            ) : f.type === "number" ? (
              <input type="text" inputMode="decimal" placeholder={f.placeholder}
                value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                style={s.input} />
            ) : (
              <input type={f.type || "text"} placeholder={f.placeholder}
                value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                style={s.input} />
            )}
          </div>
        ))}
      </div>
      {(() => {
        const amountNum = parseFloat(String(vals.amount).replace(",", "."));
        const valid = vals.name?.trim() && !isNaN(amountNum) && amountNum > 0;
        return (
          <button
            style={{ ...s.saveBtn, opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "not-allowed" }}
            disabled={!valid}
            onClick={() => onSave({ ...vals, amount: amountNum })}
          >
            {valid ? "Save" : "Fill in name and a positive amount"}
          </button>
        );
      })()}
    </Modal>
  );
}

// Two-step delete needs one armed id across the whole tree; passing it plus its
// setter into every row was two extra props on eight call sites.
const DeleteArmContext = createContext({ armedId: null, arm: () => {} });

// The trailing edit/delete cell on every entry row. Previously eight
// near-identical copies. onDelete stays a callback because the action really
// does differ per row - deleting a recurring item also drops its template.
function RowActions({ id, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  const { armedId, arm } = useContext(DeleteArmContext);
  const armed = armedId === id;
  return (
    <div style={{ flex: 0.6, textAlign: "center", display: "flex", justifyContent: "center", gap: SPACE.xxs }}>
      <button style={s.editBtn} onClick={onEdit} title="Edit">✎</button>
      <button
        style={{ ...s.delBtn, color: armed ? theme.danger : theme.textFaint, fontWeight: armed ? 700 : 400 }}
        title={armed ? "Click again to confirm" : "Delete"}
        onClick={() => { if (armed) { onDelete(); arm(null); } else arm(id); }}
      >✕</button>
    </div>
  );
}

// Column sets shared by the live tabs and the History detail view. History
// passes no sorts/onSort, which TableHeader handles by leaving those columns
// unclickable - so one definition serves both.
const ENTRY_COLUMNS = {
  expenses: [
    { label: "NAME", flex: 2, sortKey: "name" },
    { label: "CATEGORY", flex: 1.2, sortKey: "category" },
    { label: "DATE", flex: 1, sortKey: "date" },
    { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" },
    { label: "", flex: 0.6, align: "center" },
  ],
  recurring: [
    { label: "NAME", flex: 2, sortKey: "name" },
    { label: "CATEGORY", flex: 1.2, sortKey: "category" },
    { label: "DAY", flex: 0.5, align: "center", sortKey: "dayOfMonth" },
    { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" },
    { label: "", flex: 0.6, align: "center" },
  ],
  upcoming: [
    { label: "", flex: 0.3 },
    { label: "NAME", flex: 2, sortKey: "name" },
    { label: "CATEGORY", flex: 1.2, sortKey: "category" },
    { label: "DUE DATE", flex: 1, sortKey: "dueDate" },
    { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" },
    { label: "STATUS", flex: 0.7, align: "center" },
    { label: "", flex: 0.6, align: "center" },
  ],
};

// One row definition per entry type, used by the live tab and by History. They
// were duplicated character-for-character apart from which period the edit and
// delete callbacks targeted, so that is all the caller supplies.
function ExpenseRow({ entry: e, categories, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  return (
    <div style={s.tableRow}>
      <div style={{ flex: 2, fontWeight: 600 }}>{e.name}</div>
      <div style={{ flex: 1.2 }}><CategoryPill categoryName={e.category} categories={categories} /></div>
      <div style={{ flex: 1, color: theme.textMuted, ...TYPE.caption }}>{e.date}</div>
      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.danger }}>{fmt(e.amount)}</div>
      <RowActions id={e.id} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function RecurringRow({ entry: r, categories, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  return (
    <div style={s.tableRow}>
      <div style={{ flex: 2, fontWeight: 600 }}>
        {r.name}
        {r.autoPay && <span title="Pays itself" style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>auto</span>}
      </div>
      <div style={{ flex: 1.2 }}><CategoryPill categoryName={r.category} categories={categories} /></div>
      <div style={{ flex: 0.5, textAlign: "center", color: theme.textMuted, ...TYPE.caption }}>{r.dayOfMonth || "—"}</div>
      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.accent }}>{fmt(r.amount)}</div>
      <RowActions id={r.id} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function UpcomingRow({ entry: u, categories, today, onTogglePaid, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  const settled = upcomingSettled(u, today);
  return (
    <div style={{ ...s.tableRow, opacity: settled ? 0.4 : 1 }}>
      <div style={{ flex: 0.3 }}>
        <input type="checkbox" checked={settled} onChange={onTogglePaid} disabled={!!u.autoPay}
          title={u.autoPay ? "Pays itself - settles on its due date" : undefined}
          style={{ accentColor: theme.success, width: 16, height: 16, cursor: u.autoPay ? "default" : "pointer" }} />
      </div>
      <div style={{ flex: 2, fontWeight: 600, textDecoration: settled ? "line-through" : "none" }}>
        {u.name}
        {u.autoPay && <span title="Pays itself" style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>auto</span>}
      </div>
      <div style={{ flex: 1.2 }}><CategoryPill categoryName={u.category} categories={categories} /></div>
      <div style={{ flex: 1, color: theme.textMuted, ...TYPE.caption }}>{u.dueDate}</div>
      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: settled ? theme.success : theme.warning }}>{fmt(u.amount)}</div>
      <div style={{ flex: 0.7, textAlign: "center" }}>
        <span style={{ ...TYPE.microLegal, padding: "3px 10px", borderRadius: RADIUS.pill, fontWeight: 600,
          background: settled ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
          color: settled ? theme.success : theme.warning }}>{settled ? "Paid" : "Pending"}</span>
      </div>
      <RowActions id={u.id} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function StatCard({ label, value, accent, sub, icon }) {
  const { theme, s } = useThemed();
  return (
    <div style={{ ...s.statCard, borderTop: `3px solid ${accent}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.8px", color: theme.textFaint, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 20, opacity: 0.3 }}>{icon}</div>
      </div>
      <div style={{ ...TYPE.lead, fontWeight: 600, color: accent, fontFamily: FONT, fontVariantNumeric: "tabular-nums", margin: "12px 0 4px" }}>{value}</div>
      {sub && <div style={{ ...TYPE.finePrint, lineHeight: 1.4, color: theme.textFaint }}>{sub}</div>}
    </div>
  );
}

function TableHeader({ columns, sorts, onSort }) {
  const { theme, s } = useThemed();
  const showPriority = (sorts?.length || 0) > 1;
  return (
    <div style={s.tableHeader}>
      {columns.map((col, i) => {
        const isSortable = col.sortKey && onSort;
        const idx = sorts ? sorts.findIndex((sr) => sr.col === col.sortKey) : -1;
        const active = idx !== -1;
        const dir = active ? sorts[idx].dir : null;
        const arrow = active ? (dir === "asc" ? " ↑" : " ↓") : "";
        return (
          <div key={i} style={{
            flex: col.flex,
            textAlign: col.align || "left",
            cursor: isSortable ? "pointer" : "default",
            userSelect: "none",
          }} onClick={isSortable ? (e) => onSort(col.sortKey, e.shiftKey) : undefined}
             title={isSortable ? "Click to sort · Shift+Click to add" : undefined}>
            {col.label}{arrow}
            {active && showPriority && (
              <sup style={{ fontSize: 8, marginLeft: 2, color: theme.textMuted }}>{idx + 1}</sup>
            )}
          </div>
        );
      })}
    </div>
  );
}

const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

async function getAppWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

async function showAndFocusWindow() {
  try {
    const w = await getAppWindow();
    await w.unminimize();
    await w.show();
    await w.setFocus();
  } catch { /* Tauri API unavailable (browser dev server) */ }
}

/* ---- Bill reminders ------------------------------------------------------
   The checker runs here, in the webview, rather than in Rust. Closing the
   window only hides it, so this keeps ticking in the tray, and it reuses the
   period math above instead of reimplementing cutoff-day arithmetic in a
   second language where it would drift silently. */

const REMINDER_SENT_KEY = "budget-ctrl-reminders-sent";
const REMINDER_INTERVAL_MS = 30 * 60 * 1000;
const REMINDER_STARTUP_DELAY_MS = 10 * 1000;
// How long after a reminder a return to the app still counts as answering it.
const REMINDER_OPEN_WINDOW_MS = 10 * 60 * 1000;
// How far back a notification will chase an unpaid bill. It exists to stop a
// forgotten entry nagging forever - NOT to hide it. The app itself passes
// Infinity, because an unpaid bill is money owed however old it is, and
// quietly dropping it is worse than repeating it.
const OVERDUE_GRACE_DAYS = 30;

// Local-calendar day. Never toISOString() here - that shifts to UTC and lands
// on the wrong day for anyone east of Greenwich.
function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A payment is settled when it has been ticked off, or when it pays itself and
// its due date has passed. Direct debits and card-on-file subscriptions leave
// the account without anyone touching the app, so demanding a manual tick made
// them look permanently overdue.
function upcomingSettled(u, today) {
  if (u.paid) return true;
  if (!u.autoPay) return false;
  const due = new Date(u.dueDate);
  return !isNaN(due.getTime()) && startOfDay(due) <= startOfDay(today || new Date());
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
}

function collectDueBills(data, now, leadDays, graceDays = OVERDUE_GRACE_DAYS) {
  const cutoffDay = data.cutoffDay || 1;
  const key = periodKeyFor(now, cutoffDay);
  const out = [];

  for (const r of (data.months?.[key]?.recurring || [])) {
    if (r.dayOfMonth == null) continue;
    // A bill that pays itself needs no warning - that is the point of the flag.
    if (r.autoPay) continue;
    const due = recurringDateInPeriod(r.dayOfMonth, key, cutoffDay);
    const inDays = daysBetween(now, due);
    // Recurring items carry no paid flag - they count as spent once the day
    // passes - so only the run-up to the date is worth announcing.
    if (inDays >= 0 && inDays <= leadDays) {
      out.push({ id: `r-${r.id}-${key}`, kind: "recurring", entryId: r.id, periodKey: key,
                 name: r.name, amount: r.amount || 0, inDays, dueISO: isoDay(due) });
    }
  }

  // Unpaid one-offs are scanned across every period, not just the current one:
  // an item left unpaid last month stays filed under last month, and that is
  // precisely the case most worth surfacing.
  for (const [mk, m] of Object.entries(data.months || {})) {
    for (const u of (m.upcoming || [])) {
      if (u.paid || u.autoPay) continue;
      const due = new Date(u.dueDate);
      if (isNaN(due.getTime())) continue;
      const inDays = daysBetween(now, due);
      if (inDays <= leadDays && inDays >= -graceDays) {
        out.push({ id: `u-${u.id}`, kind: "upcoming", entryId: u.id, periodKey: mk,
                   name: u.name, amount: u.amount || 0, inDays, dueISO: isoDay(due) });
      }
    }
  }

  return out.sort((a, b) => a.inDays - b.inDays);
}

function whenLabel(inDays) {
  if (inDays < 0) return `${-inDays}d overdue`;
  if (inDays === 0) return "due today";
  if (inDays === 1) return "due tomorrow";
  return `due in ${inDays}d`;
}

function buildDigest(bills) {
  if (bills.length === 1) {
    const b = bills[0];
    return { title: `${b.name} — ${whenLabel(b.inDays)}`, body: `${fmt(b.amount)} · due ${b.dueISO}` };
  }
  const total = bills.reduce((a, b) => a + b.amount, 0);
  const overdue = bills.filter((b) => b.inDays < 0).length;
  // Each line carries its own date. A bare list of names gave no way to tell
  // why something had been included, which made a wrong reminder unfalsifiable.
  const lines = bills.slice(0, 3).map((b) => `${b.name} · ${fmt(b.amount)} · ${whenLabel(b.inDays)}`);
  if (bills.length > 3) lines.push(`+${bills.length - 3} more`);
  return {
    title: `${bills.length} bills due${overdue ? ` · ${overdue} overdue` : ""} · ${fmt(total)}`,
    body: lines.join("\n"),
  };
}

function readSentMarker() {
  try { return JSON.parse(localStorage.getItem(REMINDER_SENT_KEY) || "{}"); } catch { return {}; }
}

function writeSentMarker(v) {
  try { localStorage.setItem(REMINDER_SENT_KEY, JSON.stringify(v)); } catch { /* private mode or quota: a repeated reminder beats a crash */ }
}

function useReminders(data, loaded, setTodayKey, onReminderOpened) {
  // Read through a ref so the interval is installed once instead of being torn
  // down and restarted on every keystroke that edits the budget.
  const dataRef = useRef(data);
  dataRef.current = data;

  // Rollover watch, deliberately outside the Tauri guard: an app parked in the
  // tray can go days without re-rendering, leaving the header date and the
  // active period stale. setState bails out when the value is unchanged, so
  // this is free on every tick but the one that crosses midnight.
  useEffect(() => {
    const iv = setInterval(() => setTodayKey(isoDay(new Date())), 60 * 1000);
    return () => clearInterval(iv);
  }, [setTodayKey]);

  useEffect(() => {
    if (!loaded || !isTauri) return;
    let alive = true;

    const tick = async () => {
      if (!alive) return;
      const d = dataRef.current;
      const rem = d.reminders || {};
      if (rem.enabled === false) return;
      const leadDays = Number.isFinite(rem.leadDays) ? rem.leadDays : 3;

      // new Date() per tick, never a render-time value - this process outlives
      // its renders by days.
      const now = new Date();
      const bills = collectDueBills(d, now, leadDays);
      if (!bills.length) return;

      // Fire once a day, and again if the set itself changes mid-day.
      const sig = bills.map((b) => b.id).join("|");
      const today = isoDay(now);
      const sent = readSentMarker();
      if (sent.date === today && sent.sig === sig) return;

      try {
        const n = await import("@tauri-apps/plugin-notification");
        let granted = await n.isPermissionGranted();
        if (!granted) granted = (await n.requestPermission()) === "granted";
        if (!granted || !alive) return;
        const { title, body } = buildDigest(bills);
        await n.sendNotification({ title, body });
        // `at` drives the fallback below; `seen` stops it firing twice.
        writeSentMarker({ date: today, sig, at: Date.now(), seen: false });
      } catch { /* Tauri API unavailable (browser dev server) */ }
    };

    // Clicking a toast should land on the list it was about. onAction is the
    // documented hook, but the docs do not promise it fires for a body click on
    // Windows desktop - registerActionTypes is mobile-only - so it is wired
    // opportunistically and backed by a focus fallback that needs no plumbing:
    // any route back into the app shortly after a reminder lands on Due Soon.
    let unlistenAction;
    (async () => {
      try {
        const n = await import("@tauri-apps/plugin-notification");
        if (typeof n.onAction === "function") {
          unlistenAction = await n.onAction(() => {
            if (!alive) return;
            showAndFocusWindow();
            onReminderOpened();
          });
        }
      } catch { /* Tauri API unavailable (browser dev server) */ }
    })();

    const onWindowFocus = () => {
      const sent = readSentMarker();
      if (sent.at && !sent.seen && Date.now() - sent.at < REMINDER_OPEN_WINDOW_MS) {
        writeSentMarker({ ...sent, seen: true });
        onReminderOpened();
      }
      tick();
    };

    const startup = setTimeout(tick, REMINDER_STARTUP_DELAY_MS);
    const iv = setInterval(tick, REMINDER_INTERVAL_MS);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      alive = false;
      clearTimeout(startup);
      clearInterval(iv);
      window.removeEventListener("focus", onWindowFocus);
      if (unlistenAction) unlistenAction();
    };
  }, [loaded, onReminderOpened]);
}

function Switch({ checked, onChange }) {
  const { theme } = useThemed();
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: "none", padding: 0,
        cursor: "pointer", flexShrink: 0, position: "relative",
        background: checked ? theme.accent : theme.border,
        transition: "background .15s",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: "50%", background: "#fff",
        transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
      }} />
    </button>
  );
}

function SettingRow({ label, hint, children }) {
  const { theme } = useThemed();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: theme.text }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 3 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function SettingsModal({ data, onClose, onChangeReminders }) {
  const { theme, s } = useThemed();
  const rem = data.reminders || { enabled: true, leadDays: 3 };
  // null until the plugin answers; the real registry entry is the source of
  // truth, so this is never persisted into `data` where it could desync.
  const [autostart, setAutostart] = useState(null);

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    (async () => {
      try {
        const a = await import("@tauri-apps/plugin-autostart");
        const on = await a.isEnabled();
        if (alive) setAutostart(on);
      } catch { if (alive) setAutostart(false); }
    })();
    return () => { alive = false; };
  }, []);

  const toggleAutostart = async () => {
    try {
      const a = await import("@tauri-apps/plugin-autostart");
      if (autostart) { await a.disable(); setAutostart(false); }
      else { await a.enable(); setAutostart(true); }
    } catch { /* Tauri API unavailable (browser dev server) */ }
  };

  const group = { fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2, color: theme.textMuted, fontWeight: 600, marginBottom: 2 };
  const divider = { borderTop: `1px solid ${theme.border}`, margin: "6px 0" };

  return (
    <Modal title="Settings" onClose={onClose}>
      <div style={group}>Reminders</div>
      <SettingRow
        label="Remind me about due bills"
        hint={isTauri ? "Closing the window keeps Budget Ctrl running in the tray." : "Desktop app only."}
      >
        <Switch checked={rem.enabled} onChange={(v) => onChangeReminders({ ...rem, enabled: v })} />
      </SettingRow>
      {rem.enabled && (
        <SettingRow label="Days of notice" hint="How far ahead of the due date to warn you.">
          <input
            type="number" min={0} max={30} value={rem.leadDays}
            onChange={(e) => {
              const n = Math.max(0, Math.min(30, Math.floor(+e.target.value) || 0));
              onChangeReminders({ ...rem, leadDays: n });
            }}
            style={{ ...s.input, width: 72, textAlign: "center" }}
          />
        </SettingRow>
      )}

      {isTauri && (
        <>
          <div style={divider} />
          <div style={group}>Startup</div>
          <SettingRow label="Start with Windows" hint="Launches hidden in the tray, so reminders work from boot.">
            <Switch checked={!!autostart} onChange={toggleAutostart} />
          </SettingRow>
        </>
      )}
    </Modal>
  );
}

const WIN_GLYPHS = {
  minimize: "M19 13H5v-2h14z",
  maximize: "M4 4h16v16H4zm2 4v10h12V8z",
  restore: "M4 8h4V4h12v12h-4v4H4zm12 0v6h2V6h-8v2zM6 12v6h8v-6z",
  close: "M13.46 12L19 17.54V19h-1.46L12 13.46L6.46 19H5v-1.46L10.54 12L5 6.46V5h1.46L12 10.54L17.54 5H19v1.46z",
};

function WindowControls() {
  const { theme } = useThemed();
  const [maximized, setMaximized] = useState(false);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten;
    let alive = true;
    (async () => {
      try {
        const w = await getAppWindow();
        if (!alive) return;
        setMaximized(await w.isMaximized());
        unlisten = await w.onResized(async () => {
          if (alive) setMaximized(await w.isMaximized());
        });
      } catch { /* Tauri API unavailable (browser dev server) */ }
    })();
    return () => { alive = false; if (unlisten) unlisten(); };
  }, []);

  if (!isTauri) return null;

  const act = async (name) => {
    try {
      const w = await getAppWindow();
      if (name === "minimize") await w.minimize();
      else if (name === "toggle") await w.toggleMaximize();
      else if (name === "close") await w.close();
    } catch { /* Tauri API unavailable (browser dev server) */ }
  };

  const btn = (id, action, title, path) => {
    const isClose = id === "close";
    const hovered = hover === id;
    return (
      <button
        key={id}
        title={title}
        onClick={() => act(action)}
        onMouseEnter={() => setHover(id)}
        onMouseLeave={() => setHover(null)}
        style={{
          width: 46, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
          border: "none", cursor: "pointer", padding: 0, transition: "background .12s",
          background: hovered ? (isClose ? "#e81123" : theme.outerBorder) : "transparent",
          color: hovered && isClose ? "#ffffff" : theme.outerText,
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24">
          <path fill="currentColor" d={path} />
        </svg>
      </button>
    );
  };

  return (
    <div style={{ position: "absolute", top: 0, right: 0, display: "flex", alignItems: "center", zIndex: 10 }}>
      {btn("minimize", "minimize", "Minimize", WIN_GLYPHS.minimize)}
      {btn("maximize", "toggle", maximized ? "Restore" : "Maximize", maximized ? WIN_GLYPHS.restore : WIN_GLYPHS.maximize)}
      {btn("close", "close", "Close", WIN_GLYPHS.close)}
    </div>
  );
}

function InfoHint({ text }) {
  const { theme } = useThemed();
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ width: 16, height: 16, borderRadius: "50%", border: `1px solid ${theme.textFaint}`,
                 background: "transparent", color: theme.textFaint, fontSize: 10, lineHeight: 1,
                 cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>?</button>
      {open && (
        <span style={{ position: "absolute", top: 22, left: 0, zIndex: 20, width: 260,
                       background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10,
                       padding: "10px 12px", fontSize: 12, color: theme.textMuted,
                       boxShadow: theme.shadowCard, lineHeight: 1.5, fontWeight: 400,
                       textTransform: "none", letterSpacing: 0 }}>{text}</span>
      )}
    </span>
  );
}

function CategoryPill({ categoryName, categories, fallback }) {
  const { s } = useThemed();
  const cat = findCategory(categories, categoryName) || fallback || UNCATEGORIZED;
  return (
    <span style={{ ...s.catPill, background: `${cat.color}15`, color: cat.color }}>
      <span style={{ ...s.catDot, background: `${cat.color}25` }}>{cat.icon}</span>
      {cat.name}
    </span>
  );
}

function CategoryDonut({ data, total }) {
  const { theme, s } = useThemed();
  if (!data.length) {
    return <div style={s.chartEmpty}>Add expenses to see category breakdown.</div>;
  }
  return (
    <div style={{ position: "relative", width: "100%", height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={70} outerRadius={100} paddingAngle={2} stroke="none">
            {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
          </Pie>
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{d.icon} {d.name}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}>{fmt(d.value)} · {pct}%</div>
              </div>
            );
          }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Total</div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.text }}>{fmt(total)}</div>
      </div>
    </div>
  );
}

function MonthlyBarChart({ data, curKey, onBarClick }) {
  const { theme, s } = useThemed();
  if (data.length < 2) {
    return <div style={s.chartEmpty}>Come back next month to see trends.</div>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.key}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.danger }}>Spent: {fmt(d.spent)}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.textMuted }}>Income: {fmt(d.income)}</div>
              </div>
            );
          }} />
          <Bar
            dataKey="spent"
            radius={[6, 6, 0, 0]}
            onClick={(d) => { if (d && d.key !== curKey) onBarClick?.(d.key); }}
          >
            {data.map((d) => (
              <Cell
                key={d.key}
                fill={d.spent > d.income ? theme.danger : theme.accent}
                style={{ cursor: d.key !== curKey ? "pointer" : "default" }}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// A number that edits in place. Reads as plain text until hovered or focused,
// so the table stays legible but the value is obviously reachable.
function InlineNumber({ value, onChange, title }) {
  const { theme } = useThemed();
  return (
    <input
      type="number"
      className="inline-edit"
      title={title}
      value={value || ""}
      placeholder="0"
      onChange={(e) => onChange(+e.target.value || 0)}
      style={{
        width: "100%", textAlign: "right", background: "transparent",
        borderRadius: RADIUS.sm, padding: `${SPACE.xxs}px ${SPACE.xs}px`,
        color: theme.text, ...TYPE.caption, fontFamily: FONT,
        fontVariantNumeric: "tabular-nums", outline: "none", boxSizing: "border-box",
      }}
    />
  );
}

function GoalProgress({ saved, target }) {
  const { theme } = useThemed();
  const pct = target > 0 ? Math.max(0, Math.min(100, (saved / target) * 100)) : 0;
  const reached = saved >= target;
  return (
    <div style={{ height: 8, borderRadius: RADIUS.pill, background: theme.border, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, borderRadius: RADIUS.pill,
                    background: reached ? theme.success : theme.accent, transition: "width .3s" }} />
    </div>
  );
}

function SavingsChart({ series }) {
  const { theme, s } = useThemed();
  if (!series || series.length < 2) {
    return <div style={s.chartEmpty}>Close out a month to start tracking savings.</div>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <defs>
            <linearGradient id="savingsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.success} stopOpacity={0.35} />
              <stop offset="100%" stopColor={theme.success} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.label}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.success }}>Balance: {fmt(d.balance)}</div>
                {d.delta !== 0 && (
                  <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: d.delta >= 0 ? theme.success : theme.danger }}>
                    {d.delta >= 0 ? "+" : ""}{fmt(d.delta)} that month
                  </div>
                )}
              </div>
            );
          }} />
          <Area type="monotone" dataKey="balance" stroke={theme.success} strokeWidth={2} fill="url(#savingsFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryBudgets({ categories, spent, average, onSetCap }) {
  const { theme, s } = useThemed();
  const [editing, setEditing] = useState(null);
  const [draftCap, setDraftCap] = useState("");

  const startEdit = (c) => {
    setEditing(c.name);
    setDraftCap(c.cap != null ? String(c.cap) : "");
  };
  const commitEdit = () => {
    const n = parseFloat(String(draftCap).replace(",", "."));
    onSetCap(editing, isFinite(n) && n > 0 ? n : null);
    setEditing(null);
  };
  const cancelEdit = () => setEditing(null);

  const rows = categories
    .filter((c) => c.name !== "Uncategorized")
    .map((c) => {
      const sp = spent.get(c.name) || 0;
      const pct = c.cap ? (sp / c.cap) * 100 : null;
      return { ...c, sp, pct };
    })
    .sort((a, b) => {
      if (a.pct == null && b.pct == null) return a.name.localeCompare(b.name);
      if (a.pct == null) return 1;
      if (b.pct == null) return -1;
      return b.pct - a.pct;
    });

  if (rows.length === 0) {
    return <div style={s.empty}>No categories yet. Add an expense to start tracking.</div>;
  }

  return (
    <div>
      {rows.map((r) => {
        const isEditing = editing === r.name;
        const avg = average(r.name);
        const barColor = r.pct == null ? theme.border
          : r.pct > 100 ? theme.danger
          : r.pct > 80 ? theme.warning
          : theme.accent;
        return (
          <div key={r.name} style={{ padding: "12px 0", borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: r.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{r.icon}</div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!isEditing && (
                  <span style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontSize: 12, color: theme.textMuted }}>
                    {fmt(r.sp)} / {r.cap != null ? fmt(r.cap) : "—"}
                  </span>
                )}
                {!isEditing && (
                  <button style={s.editBtn} onClick={() => startEdit(r)}>{r.cap != null ? "✎" : "+"}</button>
                )}
                {isEditing && (
                  <>
                    <input type="text" inputMode="decimal" autoFocus
                      value={draftCap}
                      placeholder="Cap"
                      onChange={(e) => setDraftCap(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                      style={{ width: 80, ...s.input, padding: "6px 10px", fontSize: 12 }} />
                    <button style={s.editBtn} onClick={commitEdit}>✓</button>
                    <button style={s.delBtn} onClick={cancelEdit}>✕</button>
                  </>
                )}
              </div>
            </div>
            {r.cap != null && (
              <div style={{ height: 6, background: theme.bg, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, r.pct)}%`, height: "100%", background: barColor, transition: "width .3s" }} />
              </div>
            )}
            {avg != null && (
              <div style={{ fontSize: 11, color: theme.textFaint, marginTop: 4 }}>
                avg of past months: {fmt(avg)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(defaultData());
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [historyKey, setHistoryKey] = useState(null);
  const [yearKey, setYearKey] = useState(() => String(new Date().getFullYear()));
  const importInputRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem("themeMode") || "light"; } catch { return "light"; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Bumped by the reminder tick when the calendar date rolls over; `today`
  // below is keyed to it so a long-lived tray session doesn't show a stale date.
  const [todayKey, setTodayKey] = useState(() => isoDay(new Date()));
  const [expensesView, setExpensesView] = useState({ search: "", sorts: [] });
  const [recurringView, setRecurringView] = useState({ search: "", sorts: [] });
  const [upcomingView, setUpcomingView] = useState({ search: "", sorts: [] });
  const [creditsView, setCreditsView] = useState({ search: "", sorts: [] });
  const triggerImport = () => importInputRef.current?.click();
  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== "object" || !parsed.months || typeof parsed.months !== "object") {
          alert("Could not read backup file. Make sure it's a valid budget-ctrl JSON export.");
          return;
        }
        if (!confirm("Replace ALL current data with the contents of this backup? This cannot be undone.")) return;
        const migrated = hydrate(migrate(parsed));
        save(migrated);
      } catch {
        alert("Could not read backup file. Make sure it's a valid budget-ctrl JSON export.");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(STORAGE_KEY);
        if (r?.value) {
          const raw = JSON.parse(r.value);
          const migrated = hydrate(migrate(raw));
          setData(migrated);
          if (migrated !== raw) {
            try { await window.storage.set(STORAGE_KEY, JSON.stringify(migrated)); } catch { /* migration re-runs next load if this fails */ }
          }
        } else {
          setData(hydrate(defaultData()));
        }
      } catch { /* Tauri API unavailable (browser dev server) */ }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!pendingDelete) return;
    const t = setTimeout(() => setPendingDelete(null), 3000);
    return () => clearTimeout(t);
  }, [pendingDelete]);

  useEffect(() => {
    try { localStorage.setItem("themeMode", themeMode); } catch { /* theme falls back to light next launch */ }
  }, [themeMode]);

  const themedValue = useMemo(() => {
    const theme = themeMode === "dark" ? DARK_THEME : LIGHT_THEME;
    return { theme, s: makeStyles(theme) };
  }, [themeMode]);
  const { theme, s } = themedValue;

  const save = useCallback(async (next) => {
    setData(next);
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(next)); } catch { /* in-memory state still updated; surfaced on next load */ }
  }, []);

  const patchMonth = useCallback((key, patch) => {
    const m = data.months[key] || emptyMonth();
    // An edit to an already-closed period is a retroactive correction, so stamp
    // it. The Savings table surfaces this, otherwise a hand-corrected figure is
    // indistinguishable from a calculated one months later. ISO-UTC is right
    // here: this is an instant, not a calendar day.
    const closed = key < currentPeriodKey(data.cutoffDay || 1);
    save({
      ...data,
      months: {
        ...data.months,
        [key]: { ...m, ...patch, ...(closed ? { editedAt: new Date().toISOString() } : {}) },
      },
    });
  }, [data, save]);

  const patchCur = useCallback((patch) => {
    patchMonth(currentPeriodKey(data.cutoffDay || 1), patch);
  }, [patchMonth, data.cutoffDay]);

  const deleteArm = useMemo(() => ({ armedId: pendingDelete, arm: setPendingDelete }), [pendingDelete]);

  const openDueSoon = useCallback(() => setTab("duesoon"), []);
  useReminders(data, loaded, setTodayKey, openDueSoon);

  // Derived from todayKey rather than recomputed per render: stable within a
  // day, and guaranteed to refresh when the tick above crosses midnight. Local
  // midnight is also the right value for the day-granularity comparisons in
  // isRecurringDue, which treat period bounds as whole days.
  const today = useMemo(() => new Date(`${todayKey}T00:00:00`), [todayKey]);

  if (!loaded) return <div style={s.shell}><div style={{ color: "#6b7280", textAlign: "center", marginTop: 200, fontSize: 14 }}>Loading...</div></div>;

  const cutoffDay = data.cutoffDay || 1;
  const curKey = currentPeriodKey(cutoffDay);
  const cur = data.months[curKey] || emptyMonth();

  const totalExpenses = cur.expenses.reduce((a, e) => a + e.amount, 0);
  const totalRecurringAll = cur.recurring.reduce((a, e) => a + e.amount, 0);
  const totalRecurringPast = cur.recurring
    .filter((r) => isRecurringDue(r, curKey, today, cutoffDay))
    .reduce((a, e) => a + e.amount, 0);
  const totalRecurringFuture = totalRecurringAll - totalRecurringPast;
  const totalUnpaidUpcoming = cur.upcoming.filter((u) => !upcomingSettled(u, today)).reduce((a, e) => a + e.amount, 0);
  const totalPaidUpcoming = cur.upcoming.filter((u) => upcomingSettled(u, today)).reduce((a, e) => a + e.amount, 0);
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const allCredits = cur.credits || [];
  const creditReceived = (c) => c.dayOfMonth != null
    ? isRecurringDue(c, curKey, today, cutoffDay)
    : (c.date || "") <= todayISO;
  const totalCredits = allCredits.filter(creditReceived).reduce((a, c) => a + c.amount, 0);
  const totalCreditsPending = allCredits.filter((c) => !creditReceived(c)).reduce((a, c) => a + c.amount, 0);
  const baseIncome = cur.income;
  const effectiveIncome = baseIncome + totalCredits;
  const totalActuallySpent = totalExpenses + totalRecurringPast + totalPaidUpcoming;
  const totalStillScheduled = totalRecurringFuture + totalUnpaidUpcoming;
  const totalCommitted = totalActuallySpent;
  const availableAfterCommitted = Math.max(0, effectiveIncome - totalCommitted);
  const savingsGoal = data.savingsGoal || { monthly: 0, target: 0 };
  // Store what was typed, apply what the period can actually cover - the same
  // split the percentage version used, so a lean month cannot silently rewrite
  // the goal. The gap is surfaced rather than hidden.
  const savingsTarget = Math.min(savingsGoal.monthly, availableAfterCommitted);
  const savingsShortfall = Math.max(0, savingsGoal.monthly - availableAfterCommitted);
  const leftToSpend = Math.max(0, availableAfterCommitted - savingsTarget);
  const remaining = effectiveIncome - totalCommitted;
  const unpaidCount = cur.upcoming.filter((u) => !upcomingSettled(u, today)).length;
  const reminderLeadDays = Number.isFinite(data.reminders?.leadDays) ? data.reminders.leadDays : 3;
  // Exactly what a reminder would fire for, so the notification and the screen
  // can never disagree about what is due.
  const dueBills = collectDueBills(data, today, reminderLeadDays, Infinity);
  const totalUpcoming = totalUnpaidUpcoming;

  const catBreakdown = categoryBreakdown(cur, data.categories || [], curKey, today, cutoffDay);
  const catTotal = catBreakdown.reduce((a, c) => a + c.value, 0);
  const monthlyData = monthlyTotals(data);
  const savings = cumulativeSavings(data);
  const spentByCat = spentByCategory(cur, curKey, today, cutoffDay);
  const onSortExpenses = (col, shift) =>
    setExpensesView((v) => ({ ...v, sorts: toggleSort(v.sorts || [], col, shift) }));
  const filteredExpenses = filterAndSort(cur.expenses, expensesView);
  const onSortRecurring = (col, shift) =>
    setRecurringView((v) => ({ ...v, sorts: toggleSort(v.sorts || [], col, shift) }));
  const filteredRecurring = filterAndSort(cur.recurring, recurringView);
  const onSortUpcoming = (col, shift) =>
    setUpcomingView((v) => ({ ...v, sorts: toggleSort(v.sorts || [], col, shift) }));
  const filteredUpcoming = filterAndSort(cur.upcoming, upcomingView);
  const onSortCredits = (col, shift) =>
    setCreditsView((v) => ({ ...v, sorts: toggleSort(v.sorts || [], col, shift) }));
  const filteredCredits = filterAndSort(cur.credits || [], creditsView);
  const onChangeCutoff = (next) => {
    const clamped = Math.max(1, Math.min(28, next || 1));
    if (clamped === cutoffDay) return;
    const moves = countRebucketMoves(data, clamped);
    if (moves === 0) { save({ ...data, cutoffDay: clamped }); return; }
    const ok = confirm(
      `Re-bucket ${moves} ${moves === 1 ? "entry" : "entries"} to match the new cutoff?\n\n` +
      `Expenses, one-off credits and upcoming payments will move to the period their date falls in. ` +
      `Recurring items and income stay where they are.\n\n` +
      `Choose Cancel to change the cutoff without moving anything.`
    );
    save(ok ? { ...rebucketData(data, clamped), cutoffDay: clamped } : { ...data, cutoffDay: clamped });
  };

  const onSetCap = (name, newCap) => {
    save({
      ...data,
      categories: data.categories.map((c) => c.name === name
        ? (newCap == null ? { ...c, cap: undefined } : { ...c, cap: newCap })
        : c),
    });
  };

  return (
    <ThemeContext.Provider value={themedValue}>
    <DeleteArmContext.Provider value={deleteArm}>
    <div style={s.shell}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,600;0,700&display=swap" rel="stylesheet" />
      <style>{`
        *[data-tauri-drag-region] { app-region: drag; -webkit-app-region: drag; }
        *[data-tauri-drag-region] button,
        *[data-tauri-drag-region] input,
        *[data-tauri-drag-region] select,
        *[data-tauri-drag-region] a { app-region: no-drag; -webkit-app-region: no-drag; }

        /* Scrollbars follow the theme. color-scheme also darkens the number-input
           spinners and any other native control the panels render. */
        :root { color-scheme: ${themeMode === "dark" ? "dark" : "light"}; }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${theme.border}; border-radius: 5px; }
        ::-webkit-scrollbar-thumb:hover { background: ${theme.textFaint}; }
        ::-webkit-scrollbar-corner { background: transparent; }

        /* Interaction states. Active compresses to 0.95, focus is a 2px ring in
           Focus Blue; both are spec'd for every button. */
        button, input, select, textarea { font-family: inherit; }
        button { transition: transform .12s ease, background-color .2s ease, color .2s ease, opacity .2s ease; }
        button:active:not(:disabled) { transform: scale(0.95); }
        :focus-visible { outline: 2px solid ${FOCUS_BLUE}; outline-offset: 2px; }
        .icon-btn:hover { background: ${CHIP_GRAY} !important; }

        /* Inline-editable cells read as text until you reach for them. */
        .inline-edit { border: 1px solid transparent; transition: border-color .15s ease, background-color .15s ease; }
        .inline-edit:hover { border-color: ${theme.border}; }
        .inline-edit:focus { border-color: ${FOCUS_BLUE}; background: ${theme.bg} !important; }
      `}</style>

      {/* SIDEBAR */}
      <aside style={s.sidebar}>
        <div data-tauri-drag-region style={s.logo}>
          <div data-tauri-drag-region style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5, color: theme.outerText }}>BUDGET</div>
          <div data-tauri-drag-region style={{ fontSize: 10, letterSpacing: 3, color: theme.accent, fontWeight: 700 }}>CTRL</div>
        </div>
        <nav style={s.nav}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); if (t.id !== "history") setHistoryKey(null); }}
              style={tab === t.id ? { ...s.navItem, ...s.navItemActive } : s.navItem}>
              <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{t.icon}</span>
              <span>{t.label}</span>
              {t.id === "upcoming" && unpaidCount > 0 && <span style={s.badge}>{unpaidCount}</span>}
              {t.id === "duesoon" && dueBills.length > 0 && <span style={s.badge}>{dueBills.length}</span>}
            </button>
          ))}
        </nav>
        <div style={s.sidebarIncome}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: theme.outerTextMuted, marginBottom: 8, fontWeight: 600 }}>Monthly Income</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="number" value={cur.income || ""}
              onChange={(e) => patchCur({ income: +e.target.value || 0 })}
              placeholder="0" style={s.incomeInput} />
            <span style={{ ...TYPE.finePrint, color: theme.outerTextMuted, fontWeight: 600 }}>PLN</span>
          </div>
          {(totalCredits > 0 || totalCreditsPending > 0) && (
            <div style={{ fontSize: 11, color: "#10b981", marginTop: 6, fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}>
              + {fmt(totalCredits)} credits
              {totalCreditsPending > 0 && (
                <span style={{ color: theme.outerTextMuted }}> · {fmt(totalCreditsPending)} pending</span>
              )}
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: theme.outerTextMuted, marginBottom: 8, fontWeight: 600 }}>Month Starts On</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="number" min={1} max={28} value={cutoffDay}
                onChange={(e) => onChangeCutoff(+e.target.value)}
                style={s.incomeInput} />
              <span style={{ ...TYPE.finePrint, color: theme.outerTextMuted, fontWeight: 600 }}>day</span>
            </div>
            <div style={{ fontSize: 10, color: theme.outerTextMuted, marginTop: 4 }}>1–28 · e.g. payday</div>
          </div>
        </div>
        <div style={{ padding: "12px 20px 16px", borderTop: "1px solid " + theme.outerBorder, flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: theme.outerTextMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>DATA</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button style={s.dataLink} onClick={() => exportData(data)}>EXPORT</button>
            <button style={s.dataLink} onClick={triggerImport}>IMPORT</button>
            <button style={s.dataLink} onClick={async () => { if (confirm("Reset all data?")) await save(hydrate(defaultData())); }}>RESET</button>
          </div>
          <input type="file" accept=".json" ref={importInputRef} onChange={onImportFile} style={{ display: "none" }} />
        </div>
      </aside>

      {/* MAIN */}
      <main style={s.main}>
        <header data-tauri-drag-region style={{ ...s.topbar, position: "relative", paddingTop: isTauri ? 44 : SPACE.lg, paddingRight: SPACE.md }}>
          <WindowControls />
          {/* The whole bar drags; interactive children opt out via app-region: no-drag */}
          <div data-tauri-drag-region style={{ flex: 1, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <h1 data-tauri-drag-region style={{ ...TYPE.tagline, margin: 0, color: theme.outerText }}>
              {TABS.find((t) => t.id === tab)?.label}
            </h1>
            <div data-tauri-drag-region style={{ ...TYPE.navLink, color: theme.outerTextMuted, marginTop: 6 }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              {cutoffDay > 1 && (
                <span style={{ color: theme.outerTextMuted }}> · period {periodLabel(curKey, cutoffDay).range}</span>
              )}
            </div>
          </div>
          {/* One right-hand group in normal flow: the Add CTA plus the two icon
              controls, sharing a baseline and ending flush at the edge. */}
          <div style={{ display: "flex", alignItems: "center", gap: SPACE.xs, flexShrink: 0 }}>
            {ADD_LABELS[tab] && (
              <button style={s.addBtn} onClick={() => setModal({ type: MODAL_FOR_TAB[tab] || tab })}>
                + Add {ADD_LABELS[tab]}
              </button>
            )}
            <button
              className="icon-btn"
              style={s.themeToggle}
              onClick={() => setThemeMode((m) => m === "dark" ? "light" : "dark")}
              title={themeMode === "dark" ? "Switch to light panel" : "Switch to dark panel"}
            >
              {themeMode === "dark" ? "☀" : "☾"}
            </button>
            <button className="icon-btn" style={s.themeToggle} onClick={() => setSettingsOpen(true)} title="Settings">⚙</button>
          </div>
        </header>

        <div style={s.content}>
          <div style={s.contentInner}>
          {/* DASHBOARD */}
          {tab === "dashboard" && (
            <>
              {/* Column count is left to statsRow's auto-fit. Pinning it to
                  repeat(5, 1fr) overflowed the row, because a bare 1fr is
                  minmax(auto, 1fr) and the largest currency value refused to
                  shrink below its own content width. */}
              <div style={s.statsRow}>
                <StatCard label="Remaining" value={fmt(remaining)} accent={remaining >= 0 ? "#10b981" : "#ef4444"} sub={totalStillScheduled > 0 ? `${fmt(totalStillScheduled)} still scheduled` : "Everything's landed"} icon="↓" />
                <StatCard label="Still to Pay" value={fmt(totalUpcoming)} accent="#f59e0b" sub={`${unpaidCount} upcoming payment${unpaidCount !== 1 ? "s" : ""}`} icon="◈" />
                <StatCard label="Total Spent" value={fmt(totalActuallySpent)} accent="#ef4444" sub={`${cur.expenses.length} one-off · ${cur.recurring.length} recurring`} icon="↻" />
                {savings.monthsCounted > 0 && (
                  <StatCard label="Saved So Far" value={fmt(savings.total)}
                    accent={savings.total >= 0 ? "#10b981" : "#ef4444"}
                    sub={`Across ${savings.monthsCounted} closed month${savings.monthsCounted !== 1 ? "s" : ""}`} icon="◆" />
                )}
              </div>
              {/* Savings goal + income breakdown strip */}
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 32, alignItems: "start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={s.cardTitle}>Set Aside Each Period</div>
                      <InfoHint text="How much you mean to save out of this period's money. It is taken off before Left to Spend, so what remains is genuinely free." />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                      <input type="number" min={0} value={savingsGoal.monthly || ""} placeholder="0"
                        onChange={(e) => save({ ...data, savingsGoal: { ...savingsGoal, monthly: Math.max(0, Math.floor(+e.target.value) || 0) } })}
                        style={{ ...s.input, width: 140, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 18 }} />
                      <span style={{ ...TYPE.caption, color: theme.textMuted, fontWeight: 600 }}>PLN</span>
                    </div>
                    {savingsShortfall > 0 ? (
                      <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.warning, marginTop: 8 }}>
                        {fmt(savingsShortfall)} short this period · setting aside {fmt(savingsTarget)}
                      </div>
                    ) : savingsGoal.monthly > 0 ? (
                      <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: 8 }}>
                        Covered · {fmt(leftToSpend)} still free
                      </div>
                    ) : null}
                    {savingsGoal.target > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginBottom: 6 }}>
                          {fmt(Math.max(0, savings.total))} of {fmt(savingsGoal.target)} saved
                        </div>
                        <GoalProgress saved={savings.total} target={savingsGoal.target} />
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={s.cardTitle}>Income Breakdown</div>
                    {effectiveIncome > 0 ? (
                      <>
                        <div style={s.breakdownBar}>
                          {[
                            { pct: (totalActuallySpent / effectiveIncome) * 100, color: "#ef4444" },
                            { pct: (totalStillScheduled / effectiveIncome) * 100, color: "#f59e0b" },
                            { pct: (savingsTarget / effectiveIncome) * 100, color: "#0066cc" },
                            { pct: (leftToSpend / effectiveIncome) * 100, color: "#10b981" },
                          ].filter((x) => x.pct > 0 && isFinite(x.pct)).map((seg, i) => (
                            <div key={i} style={{ height: "100%", background: seg.color, width: `${Math.min(seg.pct, 100)}%`, transition: "width .3s" }} />
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 20, marginTop: 10, flexWrap: "wrap" }}>
                          {[
                            { color: "#ef4444", label: "Spent", val: totalActuallySpent },
                            { color: "#f59e0b", label: "Upcoming", val: totalStillScheduled },
                            { color: "#0066cc", label: "Savings", val: savingsTarget },
                            { color: "#10b981", label: "Left to spend", val: leftToSpend },
                          ].map((l) => (
                            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                              <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
                              <span style={{ color: theme.textFaint }}>{l.label}</span>
                              <span style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 600, color: theme.text }}>{fmt(l.val)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={s.emptySmall}>Set income to see breakdown</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Charts row 1: daily line + category donut */}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 16, marginBottom: 16 }}>
                <div style={s.card}>
                  <div style={s.cardTitle}>Category Budgets</div>
                  <div style={{ marginTop: 12 }}>
                    <CategoryBudgets
                      categories={data.categories}
                      spent={spentByCat}
                      average={(name) => categoryAverage(data, name, curKey)}
                      onSetCap={onSetCap}
                    />
                  </div>
                </div>
                <div style={s.card}>
                  <div style={s.cardTitle}>By Category</div>
                  <CategoryDonut data={catBreakdown} total={catTotal} />
                </div>
              </div>

              {/* Charts row 2: monthly bars */}
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={s.cardTitle}>Monthly Totals</div>
                <MonthlyBarChart
                  data={monthlyData}
                  curKey={curKey}
                  onBarClick={(key) => { setTab("history"); setHistoryKey(key); }}
                />
              </div>

              {/* Recent expenses + upcoming payments */}
              <div style={{ display: "grid", gridTemplateColumns: totalCredits > 0 ? "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
                <div style={s.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Recent Expenses</div>
                    <button style={s.linkBtn} onClick={() => setTab("expenses")}>View all →</button>
                  </div>
                  {cur.expenses.length === 0 ? (
                    <div style={s.emptySmall}>No expenses logged</div>
                  ) : cur.expenses.slice(-4).reverse().map((e) => (
                    <div key={e.id} style={s.miniRow}>
                      <div><div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div><div style={{ fontSize: 11, color: theme.textMuted }}>{e.date}</div></div>
                      <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444", fontSize: 13 }}>{fmt(e.amount)}</div>
                    </div>
                  ))}
                </div>
                <div style={s.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Upcoming Payments</div>
                    <button style={s.linkBtn} onClick={() => setTab("upcoming")}>View all →</button>
                  </div>
                  {cur.upcoming.filter((u) => !upcomingSettled(u, today)).length === 0 ? (
                    <div style={s.emptySmall}>All caught up!</div>
                  ) : cur.upcoming.filter((u) => !upcomingSettled(u, today)).slice(0, 4).map((u) => (
                    <div key={u.id} style={s.miniRow}>
                      <div><div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div><div style={{ fontSize: 11, color: theme.textMuted }}>Due {u.dueDate}</div></div>
                      <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#f59e0b", fontSize: 13 }}>{fmt(u.amount)}</div>
                    </div>
                  ))}
                </div>
                {totalCredits > 0 && (
                  <div style={s.card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={s.cardTitle}>Recent Credits</div>
                      <button style={s.linkBtn} onClick={() => setTab("credits")}>View all →</button>
                    </div>
                    {[...cur.credits].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 4).map((c) => (
                      <div key={c.id} style={s.miniRow}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: theme.textMuted }}>{c.source} · {c.date}</div>
                        </div>
                        <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#10b981", fontSize: 13 }}>+{fmt(c.amount)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* EXPENSES */}
          {tab === "duesoon" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>Due Soon</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.warning, fontSize: 16 }}>
                  {fmt(dueBills.reduce((a, b) => a + b.amount, 0))}
                </div>
              </div>
              <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginBottom: 4 }}>
                Everything a reminder would fire for: due within {reminderLeadDays} day{reminderLeadDays !== 1 ? "s" : ""},
                plus anything still unpaid past its date. Entries marked <em>pays itself</em> are excluded.
                {" "}<button style={{ ...s.linkBtn, padding: 0, ...TYPE.finePrint, fontWeight: 600 }} onClick={() => setSettingsOpen(true)}>Change the window</button>
              </div>
              {dueBills.length === 0 ? (
                <div style={s.empty}>Nothing due in the next {reminderLeadDays} day{reminderLeadDays !== 1 ? "s" : ""}.</div>
              ) : (
                <>
                  <TableHeader columns={[
                    { label: "NAME", flex: 2 }, { label: "TYPE", flex: 0.9 },
                    { label: "DUE", flex: 1 }, { label: "WHEN", flex: 1 },
                    { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 1.1, align: "right" },
                  ]} />
                  {dueBills.map((b) => (
                    <div key={b.id} style={s.tableRow}>
                      <div style={{ flex: 2, fontWeight: 600 }}>{b.name}</div>
                      <div style={{ flex: 0.9, color: theme.textMuted, ...TYPE.finePrint, lineHeight: 1.5 }}>
                        {b.kind === "recurring" ? "Recurring" : "Upcoming"}
                        {/* Reminders scan every period, but the Upcoming tab only
                            shows the current one - so an item left unpaid in an
                            earlier period was invisible while still nagging.
                            Naming its period makes that obvious. */}
                        {b.periodKey !== curKey && (
                          <span style={{ display: "block", color: theme.danger }}>
                            from {periodLabel(b.periodKey, cutoffDay).primary}
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, color: theme.textMuted, ...TYPE.caption }}>{b.dueISO}</div>
                      <div style={{ flex: 1, ...TYPE.caption, color: b.inDays < 0 ? theme.danger : b.inDays === 0 ? theme.warning : theme.textMuted }}>
                        {whenLabel(b.inDays)}
                        {b.inDays < -OVERDUE_GRACE_DAYS && (
                          <span title={`Older than ${OVERDUE_GRACE_DAYS} days, so reminders no longer mention it`}
                                style={{ display: "block", ...TYPE.microLegal, color: theme.textFaint }}>
                            not in reminders
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.warning }}>{fmt(b.amount)}</div>
                      <div style={{ flex: 1.1, textAlign: "right", display: "flex", gap: SPACE.sm, justifyContent: "flex-end" }}>
                        {b.kind === "upcoming" && (
                          <button style={{ ...s.linkBtn, padding: 0 }}
                            onClick={() => {
                              const mk = b.periodKey;
                              const mm = data.months[mk] || emptyMonth();
                              patchMonth(mk, { upcoming: mm.upcoming.map((x) => x.id === b.entryId ? { ...x, paid: true } : x) });
                            }}>Mark paid</button>
                        )}
                        <button style={{ ...s.linkBtn, padding: 0 }}
                          onClick={() => setModal({ type: b.kind === "recurring" ? "recurring" : "upcoming", editId: b.entryId, monthKey: b.periodKey })}>
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                  <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: SPACE.md }}>
                    Something here that pays itself? Open it and tick <em>Pays itself</em> — it will settle on its own date and stop reminding.
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "expenses" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>All Expenses</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444", fontSize: 16 }}>Total: {fmt(totalExpenses)}</div>
              </div>
              <input
                type="text"
                placeholder="Search expenses..."
                value={expensesView.search}
                onChange={(e) => setExpensesView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredExpenses.length === 0 ? <div style={s.empty}>{expensesView.search ? `No expenses match "${expensesView.search}".` : `No expenses yet. Click "+ Add Expense" to start tracking.`}</div> : (
                <>
                  <TableHeader columns={ENTRY_COLUMNS.expenses} sorts={expensesView.sorts} onSort={onSortExpenses} />
                  {filteredExpenses.map((e) => (
                    <ExpenseRow key={e.id} entry={e} categories={data.categories}
                      onEdit={() => setModal({ type: "expense", editId: e.id })}
                      onDelete={() => patchCur({ expenses: cur.expenses.filter((x) => x.id !== e.id) })} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* RECURRING */}
          {tab === "recurring" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>Recurring Payments</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#0066cc", fontSize: 16 }}>Monthly: {fmt(totalRecurringAll)}</div>
              </div>
              <input
                type="text"
                placeholder="Search recurring..."
                value={recurringView.search}
                onChange={(e) => setRecurringView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredRecurring.length === 0 ? <div style={s.empty}>{recurringView.search ? `No recurring items match "${recurringView.search}".` : `No recurring payments set up. Click "+ Add Recurring" to create one.`}</div> : (
                <>
                  <TableHeader columns={ENTRY_COLUMNS.recurring} sorts={recurringView.sorts} onSort={onSortRecurring} />
                  {filteredRecurring.map((r) => (
                    <RecurringRow key={r.id} entry={r} categories={data.categories}
                      onEdit={() => setModal({ type: "recurring", editId: r.id })}
                      onDelete={() => save({
                        ...data,
                        months: { ...data.months, [curKey]: { ...cur, recurring: cur.recurring.filter((x) => x.id !== r.id) } },
                        recurringTemplate: data.recurringTemplate.filter((x) => x.id !== r.templateId),
                      })} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* UPCOMING */}
          {tab === "upcoming" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>Upcoming Payments</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#f59e0b", fontSize: 16 }}>Owed: {fmt(totalUpcoming)}</div>
              </div>
              <input
                type="text"
                placeholder="Search upcoming..."
                value={upcomingView.search}
                onChange={(e) => setUpcomingView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredUpcoming.length === 0 ? <div style={s.empty}>{upcomingView.search ? `No upcoming items match "${upcomingView.search}".` : `No upcoming payments. Click "+ Add Payment" to schedule one.`}</div> : (
                <>
                  <TableHeader columns={ENTRY_COLUMNS.upcoming} sorts={upcomingView.sorts} onSort={onSortUpcoming} />
                  {filteredUpcoming.map((u) => (
                    <UpcomingRow key={u.id} entry={u} categories={data.categories} today={today}
                      onTogglePaid={() => patchCur({ upcoming: cur.upcoming.map((x) => x.id === u.id ? { ...x, paid: !x.paid } : x) })}
                      onEdit={() => setModal({ type: "upcoming", editId: u.id })}
                      onDelete={() => patchCur({ upcoming: cur.upcoming.filter((x) => x.id !== u.id) })} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* CREDITS */}
          {tab === "credits" && (() => {
            const recurringCredits = filteredCredits.filter((c) => c.dayOfMonth != null);
            const oneOffCredits = filteredCredits.filter((c) => c.dayOfMonth == null);
            const creditRow = (c, kind) => (
              <div key={c.id} style={s.tableRow}>
                <div style={{ flex: 2, fontWeight: 600 }}>{c.name}</div>
                <div style={{ flex: 1.2 }}><CategoryPill categoryName={c.category || c.source} categories={data.creditCategories || []} fallback={CREDIT_UNCATEGORIZED} /></div>
                {kind === "recurring"
                  ? <div style={{ flex: 1, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>{c.dayOfMonth || "—"}</div>
                  : <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{c.date}</div>}
                <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: creditReceived(c) ? "#10b981" : theme.textMuted }}>+{fmt(c.amount)}</div>
                <RowActions
                  id={c.id}
                  onEdit={() => setModal({ type: kind === "recurring" ? "creditRecurring" : "credit", editId: c.id })}
                  onDelete={() => {
                    if (kind === "recurring") {
                      save({
                        ...data,
                        months: { ...data.months, [curKey]: { ...cur, credits: (cur.credits || []).filter((x) => x.id !== c.id) } },
                        creditTemplate: (data.creditTemplate || []).filter((t) => t.id !== c.templateId),
                      });
                    } else {
                      patchCur({ credits: (cur.credits || []).filter((x) => x.id !== c.id) });
                    }
                  }}
                />
              </div>
            );
            return (
              <>
                <div style={s.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={s.cardTitle}>Credits</div>
                    <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#10b981", fontSize: 16 }}>
                      Received: {fmt(totalCredits)}
                      {totalCreditsPending > 0 && <span style={{ color: theme.textMuted, fontSize: 13 }}> · {fmt(totalCreditsPending)} pending</span>}
                    </div>
                  </div>
                  <input
                    type="text"
                    placeholder="Search credits..."
                    value={creditsView.search}
                    onChange={(e) => setCreditsView((v) => ({ ...v, search: e.target.value }))}
                    style={s.searchInput}
                  />
                </div>

                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Recurring Credits</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "creditRecurring" })}>+ Add Recurring</button>
                  </div>
                  {recurringCredits.length === 0 ? (
                    <div style={s.emptySmall}>{creditsView.search ? "No recurring credits match your search." : "No recurring credits. Add an allowance, stipend, or retainer."}</div>
                  ) : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2, sortKey: "name" }, { label: "SOURCE", flex: 1.2, sortKey: "category" }, { label: "DAY", flex: 1, align: "center", sortKey: "dayOfMonth" }, { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" }, { label: "", flex: 0.6, align: "center" }]} sorts={creditsView.sorts} onSort={onSortCredits} />
                      {recurringCredits.map((c) => creditRow(c, "recurring"))}
                    </>
                  )}
                </div>

                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>One-off Credits</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "credit" })}>+ Add Credit</button>
                  </div>
                  {oneOffCredits.length === 0 ? (
                    <div style={s.emptySmall}>{creditsView.search ? "No one-off credits match your search." : "No one-off credits this month. Log a refund, gift, or bonus."}</div>
                  ) : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2, sortKey: "name" }, { label: "SOURCE", flex: 1.2, sortKey: "category" }, { label: "DATE", flex: 1, sortKey: "date" }, { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" }, { label: "", flex: 0.6, align: "center" }]} sorts={creditsView.sorts} onSort={onSortCredits} />
                      {oneOffCredits.map((c) => creditRow(c, "oneoff"))}
                    </>
                  )}
                </div>
              </>
            );
          })()}

          {/* HISTORY - LIST */}
          {tab === "history" && historyKey === null && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={s.cardTitle}>Past Months</div>
              </div>
              {(() => {
                const pastKeys = Object.keys(data.months).filter((k) => k !== curKey).sort().reverse();
                if (pastKeys.length === 0) {
                  return <div style={s.empty}>No past months yet. Come back after the month ends.</div>;
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                    {pastKeys.map((k) => {
                      const m = data.months[k];
                      const credits = (m.credits || []).reduce((a, c) => a + c.amount, 0);
                      const spent = m.expenses.reduce((a, e) => a + e.amount, 0) + m.recurring.reduce((a, e) => a + e.amount, 0);
                      const effective = m.income + credits;
                      const rem = effective - spent;
                      const color = rem >= 0 ? "#10b981" : "#ef4444";
                      return (
                        <button key={k} onClick={() => setHistoryKey(k)} style={{
                          background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20,
                          textAlign: "left", cursor: "pointer", display: "grid",
                          gridTemplateColumns: "1.5fr 1fr 1fr 1fr 8px", gap: 16, alignItems: "center",
                          color: theme.text, fontFamily: FONT,
                        }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 16 }}>{periodLabel(k, cutoffDay).primary}</div>
                            {periodLabel(k, cutoffDay).range && (
                              <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>{periodLabel(k, cutoffDay).range}</div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Income</div>
                            <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(m.income)}</div>
                            {credits > 0 && (
                              <div style={{ fontSize: 10, color: "#10b981", fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}>+{fmt(credits)}</div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Spent</div>
                            <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444" }}>{fmt(spent)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Remaining</div>
                            <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color }}>{fmt(rem)}</div>
                          </div>
                          <div style={{ width: 8, height: 40, background: color, borderRadius: 4 }} />
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* HISTORY - DETAIL */}
          {tab === "history" && historyKey !== null && (() => {
            const m = data.months[historyKey] || emptyMonth();
            const spent = m.expenses.reduce((a, e) => a + e.amount, 0);
            const rec = m.recurring.reduce((a, e) => a + e.amount, 0);
            const credits = (m.credits || []).reduce((a, c) => a + c.amount, 0);
            const effective = m.income + credits;
            const rem = effective - spent - rec;
            return (
              <>
                <button style={{ ...s.linkBtn, marginBottom: 16, fontSize: 14 }} onClick={() => setHistoryKey(null)}>← Back to History</button>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>{periodLabel(historyKey, cutoffDay).primary}</h2>
                {periodLabel(historyKey, cutoffDay).range && (
                  <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 12 }}>{periodLabel(historyKey, cutoffDay).range}</div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: theme.textMuted, fontWeight: 600 }}>Income</span>
                  <input type="number" value={m.income || ""}
                    onChange={(ev) => patchMonth(historyKey, { income: +ev.target.value || 0 })}
                    placeholder="0" style={{ ...s.input, width: 140 }} />
                  <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600 }}>PLN</span>
                </div>
                <div style={s.statsRow}>
                  <StatCard label="Income" value={fmt(effective)} accent="#10b981" sub={credits > 0 ? `+${fmt(credits)} credits` : "For this month"} icon="↑" />
                  <StatCard label="Remaining" value={fmt(rem)} accent={rem >= 0 ? "#10b981" : "#ef4444"} sub="After expenses & recurring" icon="↓" />
                  <StatCard label="Total Spent" value={fmt(spent + rec)} accent="#ef4444" sub={`${m.expenses.length} one-off · ${m.recurring.length} recurring`} icon="↻" />
                </div>
                <div style={s.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Expenses</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "expense", monthKey: historyKey })}>+ Add</button>
                  </div>
                  {m.expenses.length === 0 ? <div style={s.emptySmall}>No expenses</div> : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "CATEGORY", flex: 1.2 }, { label: "DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 0.6, align: "center" }]} />
                      {m.expenses.map((e) => (
                        <ExpenseRow key={e.id} entry={e} categories={data.categories}
                          onEdit={() => setModal({ type: "expense", editId: e.id, monthKey: historyKey })}
                          onDelete={() => patchMonth(historyKey, { expenses: m.expenses.filter((x) => x.id !== e.id) })} />
                      ))}
                    </>
                  )}
                </div>
                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Recurring</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "recurring", monthKey: historyKey })}>+ Add</button>
                  </div>
                  {m.recurring.length === 0 ? <div style={s.emptySmall}>No recurring</div> : (
                    <>
                      <TableHeader columns={ENTRY_COLUMNS.recurring} />
                      {m.recurring.map((r) => (
                        <RecurringRow key={r.id} entry={r} categories={data.categories}
                          onEdit={() => setModal({ type: "recurring", editId: r.id, monthKey: historyKey })}
                          // Past-period deletion removes only this period's instance -
                          // the live template keeps governing future periods.
                          onDelete={() => patchMonth(historyKey, { recurring: m.recurring.filter((x) => x.id !== r.id) })} />
                      ))}
                    </>
                  )}
                </div>
                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Upcoming</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "upcoming", monthKey: historyKey })}>+ Add</button>
                  </div>
                  {m.upcoming.length === 0 ? <div style={s.emptySmall}>No upcoming</div> : (
                    <>
                      <TableHeader columns={ENTRY_COLUMNS.upcoming} />
                      {m.upcoming.map((u) => (
                        <UpcomingRow key={u.id} entry={u} categories={data.categories} today={today}
                          onTogglePaid={() => patchMonth(historyKey, { upcoming: m.upcoming.map((x) => x.id === u.id ? { ...x, paid: !x.paid } : x) })}
                          onEdit={() => setModal({ type: "upcoming", editId: u.id, monthKey: historyKey })}
                          onDelete={() => patchMonth(historyKey, { upcoming: m.upcoming.filter((x) => x.id !== u.id) })} />
                      ))}
                    </>
                  )}
                </div>
                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Credits</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "credit", monthKey: historyKey })}>+ Add</button>
                  </div>
                  {(m.credits || []).length === 0 ? <div style={s.emptySmall}>No credits</div> : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "SOURCE", flex: 1.2 }, { label: "DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 0.6, align: "center" }]} />
                      {(m.credits || []).map((c) => (
                        <div key={c.id} style={s.tableRow}>
                          <div style={{ flex: 2, fontWeight: 600 }}>{c.name}</div>
                          <div style={{ flex: 1.2 }}><CategoryPill categoryName={c.category || c.source} categories={data.creditCategories || []} fallback={CREDIT_UNCATEGORIZED} /></div>
                          <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{c.date}</div>
                          <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#10b981" }}>+{fmt(c.amount)}</div>
                          <RowActions
                            id={c.id}
                            onEdit={() => setModal({ type: "credit", editId: c.id, monthKey: historyKey })}
                            onDelete={() => patchMonth(historyKey, { credits: (m.credits || []).filter((x) => x.id !== c.id) })}
                          />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </>
            );
          })()}
          {tab === "year" && (() => {
            const allYears = Array.from(new Set(Object.keys(data.months).map((k) => k.slice(0, 4)))).sort();
            const monthsInYear = Object.entries(data.months)
              .filter(([k]) => k.startsWith(yearKey + "-"));

            const totalIncomeY = monthsInYear.reduce((a, [, m]) => {
              const cr = (m.credits || []).reduce((aa, c) => aa + c.amount, 0);
              return a + (m.income || 0) + cr;
            }, 0);
            const totalSpentY = monthsInYear.reduce((a, [k, m]) => {
              const exp = (m.expenses || []).reduce((aa, e) => aa + e.amount, 0);
              const rec = (m.recurring || [])
                .filter((r) => isRecurringDue(r, k, today, cutoffDay))
                .reduce((aa, r) => aa + r.amount, 0);
              return a + exp + rec;
            }, 0);
            const totalSavedY = totalIncomeY - totalSpentY;
            const monthsCount = monthsInYear.length;
            const avgMonthlySpend = monthsCount > 0 ? totalSpentY / monthsCount : 0;

            const yearCatTotals = new Map();
            for (const [k, m] of monthsInYear) {
              for (const e of (m.expenses || [])) yearCatTotals.set(e.category, (yearCatTotals.get(e.category) || 0) + e.amount);
              for (const r of (m.recurring || [])) {
                if (isRecurringDue(r, k, today, cutoffDay)) {
                  yearCatTotals.set(r.category, (yearCatTotals.get(r.category) || 0) + r.amount);
                }
              }
            }
            const yearCatBreakdown = Array.from(yearCatTotals.entries()).map(([name, value]) => {
              const cat = (data.categories || []).find((c) => c.name === name) || { color: "#9ca3af", icon: "·" };
              return { name, value, color: cat.color, icon: cat.icon };
            }).sort((a, b) => b.value - a.value);
            const yearCatTotal = yearCatBreakdown.reduce((a, c) => a + c.value, 0);

            // Navigation steps between years that actually hold data, rather than
            // +/- 1 calendar year. Stepping into an empty year showed a page of
            // zeroes, and a gap year used to dead-end the button entirely.
            const earlierYears = allYears.filter((y) => y < yearKey);
            const laterYears = allYears.filter((y) => y > yearKey);
            const prevYear = earlierYears.length ? earlierYears[earlierYears.length - 1] : null;
            const nextYear = laterYears.length ? laterYears[0] : null;
            // Year-over-year always compares against the real preceding calendar
            // year, which is a different question from "where can I navigate".
            const compareYear = String(Number(yearKey) - 1);

            // 12-month Jan–Dec series (months with no data render as zero)
            const monthBars = Array.from({ length: 12 }, (_, i) => {
              const k = `${yearKey}-${String(i + 1).padStart(2, "0")}`;
              const label = new Date(2000, i, 1).toLocaleDateString("en-US", { month: "short" });
              const m = data.months[k];
              if (!m) return { key: k, label, spent: 0, income: 0 };
              const exp = (m.expenses || []).reduce((a, e) => a + e.amount, 0);
              const rec = (m.recurring || []).filter((r) => isRecurringDue(r, k, today, cutoffDay)).reduce((a, r) => a + r.amount, 0);
              const cr = (m.credits || []).reduce((a, c) => a + c.amount, 0);
              return { key: k, label, spent: exp + rec, income: (m.income || 0) + cr };
            });

            // Year-over-year comparison
            const prevMonths = Object.entries(data.months).filter(([k]) => k.startsWith(compareYear + "-"));
            const prevIncomeY = prevMonths.reduce((a, [, m]) =>
              a + (m.income || 0) + (m.credits || []).reduce((x, c) => x + c.amount, 0), 0);
            const prevSpentY = prevMonths.reduce((a, [k, m]) =>
              a + (m.expenses || []).reduce((x, e) => x + e.amount, 0)
                + (m.recurring || []).filter((r) => isRecurringDue(r, k, today, cutoffDay)).reduce((x, r) => x + r.amount, 0), 0);
            const yoySub = (curr, prev) => {
              if (!(prev > 0)) return null;
              const d = ((curr - prev) / prev) * 100;
              return `${d >= 0 ? "↑" : "↓"} ${Math.abs(d).toFixed(0)}% vs ${compareYear}`;
            };

            // Top 5 biggest one-off expenses
            const topExpenses = monthsInYear
              .flatMap(([, m]) => (m.expenses || []))
              .sort((a, b) => b.amount - a.amount)
              .slice(0, 5);

            // Income sources
            const incomeSources = new Map();
            let baseIncomeY = 0;
            for (const [, m] of monthsInYear) {
              baseIncomeY += (m.income || 0);
              for (const c of (m.credits || [])) {
                const name = c.category || c.source || "Other";
                incomeSources.set(name, (incomeSources.get(name) || 0) + c.amount);
              }
            }
            const incomeBreakdown = [
              ...(baseIncomeY > 0 ? [{ name: "Base Income", value: baseIncomeY, color: "#0066cc", icon: "💼" }] : []),
              ...Array.from(incomeSources.entries()).map(([name, value]) => {
                const cat = (data.creditCategories || []).find((c) => c.name === name) || CREDIT_UNCATEGORIZED;
                return { name, value, color: cat.color, icon: cat.icon };
              }),
            ].sort((a, b) => b.value - a.value);
            const incomeTotal = incomeBreakdown.reduce((a, c) => a + c.value, 0);

            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: SPACE.md, marginBottom: SPACE.md }}>
                  <div style={{ justifySelf: "end" }}>
                    {prevYear && <button style={s.linkBtn} onClick={() => setYearKey(prevYear)}>← {prevYear}</button>}
                  </div>
                  <h2 style={{ ...TYPE.displayMedium, margin: 0 }}>{yearKey}</h2>
                  <div style={{ justifySelf: "start" }}>
                    {nextYear && <button style={s.linkBtn} onClick={() => setYearKey(nextYear)}>{nextYear} →</button>}
                  </div>
                </div>
                {monthsCount === 0 ? (
                  <div style={s.empty}>No data for {yearKey}.</div>
                ) : (
                  <>
                    <div style={s.statsRow}>
                      <StatCard label="Total Income" value={fmt(totalIncomeY)} accent="#10b981"
                        sub={yoySub(totalIncomeY, prevIncomeY) || `${monthsCount} month${monthsCount !== 1 ? "s" : ""} tracked`} icon="↑" />
                      <StatCard label="Total Spent" value={fmt(totalSpentY)} accent="#ef4444"
                        sub={yoySub(totalSpentY, prevSpentY) || "Across the year"} icon="↻" />
                      <StatCard label="Total Saved" value={fmt(totalSavedY)}
                        accent={totalSavedY >= 0 ? "#10b981" : "#ef4444"}
                        sub={totalSavedY >= 0 ? "Income minus spent" : "Overspent"} icon="↓" />
                      <StatCard label="Avg Monthly" value={fmt(avgMonthlySpend)} accent="#0066cc"
                        sub="Spending per month" icon="◐" />
                    </div>

                    <div style={{ ...s.card, marginTop: 16 }}>
                      <div style={s.cardTitle}>Monthly Breakdown — {yearKey}</div>
                      <MonthlyBarChart data={monthBars} curKey={curKey}
                        onBarClick={(key) => { if (data.months[key]) { setTab("history"); setHistoryKey(key); } }} />
                    </div>

                    <div style={{ ...s.card, marginTop: 16 }}>
                      <div style={s.cardTitle}>Category Breakdown — {yearKey}</div>
                      <CategoryDonut data={yearCatBreakdown} total={yearCatTotal} />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, marginTop: 16 }}>
                      <div style={s.card}>
                        <div style={s.cardTitle}>Biggest Expenses — {yearKey}</div>
                        {topExpenses.length === 0 ? (
                          <div style={s.emptySmall}>No expenses recorded for {yearKey}.</div>
                        ) : (
                          <>
                            <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "CATEGORY", flex: 1.2 }, { label: "DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }]} />
                            {topExpenses.map((e) => (
                              <div key={e.id} style={s.tableRow}>
                                <div style={{ flex: 2, fontWeight: 600 }}>{e.name}</div>
                                <div style={{ flex: 1.2 }}><CategoryPill categoryName={e.category} categories={data.categories} /></div>
                                <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{e.date}</div>
                                <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444" }}>{fmt(e.amount)}</div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                      <div style={s.card}>
                        <div style={s.cardTitle}>Income Sources — {yearKey}</div>
                        <CategoryDonut data={incomeBreakdown} total={incomeTotal} />
                      </div>
                    </div>
                  </>
                )}
              </>
            );
          })()}

          {/* SAVINGS */}
          {tab === "savings" && (
            <>
              <div style={s.card}>
                <div style={s.cardTitle}>Saved So Far</div>
                <div style={{ fontSize: 40, fontWeight: 700, fontFamily: FONT, fontVariantNumeric: "tabular-nums",
                              color: savings.total >= 0 ? "#10b981" : "#ef4444", margin: "12px 0 4px" }}>
                  {fmt(savings.total)}
                </div>
                <div style={{ fontSize: 12, color: theme.textMuted }}>
                  Across {savings.monthsCounted} closed period{savings.monthsCounted !== 1 ? "s" : ""}
                </div>
              </div>

              <div style={{ ...s.card, marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={s.cardTitle}>Starting Balance</div>
                  <InfoHint text="Money you'd already saved before you started using Budget Ctrl. Everything after this is calculated from your closed periods — this just sets where the count begins." />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <input type="number" value={data.startingBalance || ""}
                    onChange={(e) => save({ ...data, startingBalance: +e.target.value || 0 })}
                    placeholder="0" style={{ ...s.input, width: 180 }} />
                  <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600 }}>PLN</span>
                </div>
              </div>

              <div style={{ ...s.card, marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={s.cardTitle}>Savings Goal</div>
                  <InfoHint text="The total you're saving up to. Progress is measured against everything saved across closed periods, including your starting balance." />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <input type="number" min={0} value={savingsGoal.target || ""} placeholder="0"
                    onChange={(e) => save({ ...data, savingsGoal: { ...savingsGoal, target: Math.max(0, Math.floor(+e.target.value) || 0) } })}
                    style={{ ...s.input, width: 180 }} />
                  <span style={{ ...TYPE.caption, color: theme.textMuted, fontWeight: 600 }}>PLN</span>
                </div>
                {savingsGoal.target > 0 ? (() => {
                  const remainingToGoal = savingsGoal.target - savings.total;
                  // Pace comes from closed periods only, so it reflects what you
                  // actually saved rather than what you intended to.
                  const closed = savings.series.slice(1);
                  const avgDelta = closed.length ? closed.reduce((a, r) => a + r.delta, 0) / closed.length : 0;
                  const periodsLeft = remainingToGoal > 0 && avgDelta > 0 ? Math.ceil(remainingToGoal / avgDelta) : null;
                  return (
                    <div style={{ marginTop: 16 }}>
                      <GoalProgress saved={savings.total} target={savingsGoal.target} />
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                        <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint }}>
                          {fmt(Math.max(0, savings.total))} of {fmt(savingsGoal.target)}
                        </span>
                        <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: remainingToGoal <= 0 ? theme.success : theme.textFaint }}>
                          {remainingToGoal <= 0
                            ? "Goal reached"
                            : periodsLeft
                              ? `${fmt(remainingToGoal)} to go · about ${periodsLeft} more period${periodsLeft !== 1 ? "s" : ""} at your recent pace`
                              : `${fmt(remainingToGoal)} to go`}
                        </span>
                      </div>
                    </div>
                  );
                })() : (
                  <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: 8 }}>
                    Set a target to track progress against it.
                  </div>
                )}
              </div>

              <div style={{ ...s.card, marginTop: 16 }}>
                <div style={s.cardTitle}>Savings Over Time</div>
                <SavingsChart series={savings.series} />
              </div>

              <div style={{ ...s.card, marginTop: 16 }}>
                <div style={s.cardTitle}>Period by Period</div>
                {savings.series.length < 2 ? (
                  <div style={s.emptySmall}>Close out a period to start tracking savings.</div>
                ) : (
                  <>
                    <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: SPACE.xs }}>
                      Income is editable here. For expenses, open the period.
                    </div>
                    <TableHeader columns={[
                      { label: "PERIOD", flex: 2 }, { label: "INCOME", flex: 1, align: "right" },
                      { label: "SPENT", flex: 1, align: "right" }, { label: "CHANGE", flex: 1, align: "right" },
                      { label: "BALANCE", flex: 1, align: "right" }, { label: "", flex: 0.8, align: "right" },
                    ]} />
                    {savings.series.slice(1).map((row) => (
                      <div key={row.key} style={s.tableRow}>
                        <div style={{ flex: 2, fontWeight: 600, display: "flex", alignItems: "center", gap: SPACE.xs }}>
                          {periodLabel(row.key, cutoffDay).primary}
                          {row.editedAt && (
                            <span
                              title={`Edited after this period closed, on ${new Date(row.editedAt).toLocaleDateString()}`}
                              style={{ ...TYPE.microLegal, color: theme.textFaint, border: `1px solid ${theme.border}`, borderRadius: RADIUS.pill, padding: "1px 7px", fontWeight: 400 }}
                            >edited</span>
                          )}
                        </div>
                        <div style={{ flex: 1 }}>
                          <InlineNumber
                            value={data.months[row.key]?.income || 0}
                            title="Base income for this period"
                            onChange={(v) => patchMonth(row.key, { income: v })}
                          />
                        </div>
                        <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.textMuted }}>{fmt(row.spent)}</div>
                        <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: row.delta >= 0 ? "#10b981" : "#ef4444" }}>{row.delta >= 0 ? "+" : ""}{fmt(row.delta)}</div>
                        <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(row.balance)}</div>
                        <div style={{ flex: 0.8, textAlign: "right" }}>
                          <button
                            style={{ ...s.linkBtn, padding: 0 }}
                            title="Open this period to edit its expenses, recurring items and credits"
                            onClick={() => { setTab("history"); setHistoryKey(row.key); }}
                          >Open →</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )}
        </div>
        </div>
      </main>

      {/* MODALS */}
      {modal?.type === "expense" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const editing = modal.editId ? targetMonth.expenses.find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Expense" : "Add Expense"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Groceries", defaultValue: editing?.name },
            { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "date", label: "Date", type: "date", defaultValue: editing?.date || `${targetKey}-01` },
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const { categories, category } = ensureCategory(data.categories, v.category);
            if (editing) {
              save({
                ...data,
                categories,
                months: {
                  ...data.months,
                  [targetKey]: {
                    ...targetMonth,
                    expenses: targetMonth.expenses.map((x) => x.id === editing.id
                      ? { ...x, name: v.name, amount: +v.amount, date: v.date, category: category.name }
                      : x),
                  },
                },
              });
            } else {
              const newExp = { id: uid(), name: v.name, amount: +v.amount, date: v.date, category: category.name };
              save({
                ...data,
                categories,
                months: { ...data.months, [targetKey]: { ...targetMonth, expenses: [...targetMonth.expenses, newExp] } },
              });
            }
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "recurring" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        // Editing a PAST month is a correction to history only — it must not rewrite
        // the live template, which governs future months.
        const touchesTemplate = targetKey === curKey;
        const editing = modal.editId ? targetMonth.recurring.find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Recurring Payment" : "Add Recurring Payment"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Rent", defaultValue: editing?.name },
            { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "dayOfMonth", label: "Day of Month", type: "number", placeholder: "1", defaultValue: editing ? String(editing.dayOfMonth) : "" },
            { key: "autoPay", label: "Pays itself", type: "checkbox", defaultValue: editing?.autoPay,
              hint: "Direct debit or card on file. Never sends a reminder." },
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const { categories, category } = ensureCategory(data.categories, v.category);
            if (editing) {
              const updatedItem = {
                ...editing,
                name: v.name,
                amount: +v.amount,
                dayOfMonth: +v.dayOfMonth || 1,
                category: category.name,
                autoPay: !!v.autoPay,
              };
              save({
                ...data,
                categories,
                months: {
                  ...data.months,
                  [targetKey]: {
                    ...targetMonth,
                    recurring: targetMonth.recurring.map((x) => x.id === editing.id ? updatedItem : x),
                  },
                },
                recurringTemplate: touchesTemplate
                  ? data.recurringTemplate.map((t) =>
                      t.id === editing.templateId
                        ? { ...t, name: v.name, amount: +v.amount, dayOfMonth: +v.dayOfMonth || 1, category: category.name }
                        : t
                    )
                  : data.recurringTemplate,
              });
            } else {
              const tid = uid();
              const newItem = { id: uid(), templateId: tid, name: v.name, amount: +v.amount, dayOfMonth: +v.dayOfMonth || 1, category: category.name, autoPay: !!v.autoPay };
              save({
                ...data,
                categories,
                months: { ...data.months, [targetKey]: { ...targetMonth, recurring: [...targetMonth.recurring, newItem] } },
                recurringTemplate: touchesTemplate
                  ? [...data.recurringTemplate, { id: tid, name: v.name, amount: +v.amount, dayOfMonth: +v.dayOfMonth || 1, category: category.name }]
                  : data.recurringTemplate,
              });
            }
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "upcoming" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const editing = modal.editId ? targetMonth.upcoming.find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Upcoming Payment" : "Add Upcoming Payment"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Car Insurance", defaultValue: editing?.name },
            { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "dueDate", label: "Due Date", type: "date", defaultValue: editing?.dueDate || `${targetKey}-01` },
            { key: "autoPay", label: "Pays itself", type: "checkbox", defaultValue: editing?.autoPay,
              hint: "Direct debit or card on file. Counts as paid on its due date and never sends a reminder." },
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const { categories, category } = ensureCategory(data.categories, v.category);
            if (editing) {
              save({
                ...data,
                categories,
                months: {
                  ...data.months,
                  [targetKey]: {
                    ...targetMonth,
                    upcoming: targetMonth.upcoming.map((x) => x.id === editing.id
                      ? { ...x, name: v.name, amount: +v.amount, dueDate: v.dueDate, category: category.name, autoPay: !!v.autoPay }
                      : x),
                  },
                },
              });
            } else {
              const newItem = { id: uid(), name: v.name, amount: +v.amount, dueDate: v.dueDate, paid: false, autoPay: !!v.autoPay, category: category.name };
              save({
                ...data,
                categories,
                months: { ...data.months, [targetKey]: { ...targetMonth, upcoming: [...targetMonth.upcoming, newItem] } },
              });
            }
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "creditRecurring" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const touchesTemplate = targetKey === curKey;
        const editing = modal.editId ? (targetMonth.credits || []).find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Recurring Credit" : "Add Recurring Credit"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Allowance", defaultValue: editing?.name },
            { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Source", type: "category", categories: data.creditCategories || [], defaultValue: editing?.category },
            { key: "dayOfMonth", label: "Day of Month", type: "number", placeholder: "1", defaultValue: editing ? String(editing.dayOfMonth) : "" },
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const amt = +v.amount;
            if (!v.name || !(amt > 0)) { setModal(null); return; }
            const { categories: creditCategories, category } = ensureCreditCategory(data.creditCategories || [], v.category);
            const day = +v.dayOfMonth || 1;
            if (editing) {
              const updated = { ...editing, name: v.name, amount: amt, dayOfMonth: day, category: category.name };
              save({
                ...data,
                creditCategories,
                months: { ...data.months, [targetKey]: { ...targetMonth, credits: (targetMonth.credits || []).map((x) => x.id === editing.id ? updated : x) } },
                creditTemplate: touchesTemplate
                  ? (data.creditTemplate || []).map((t) => t.id === editing.templateId
                      ? { ...t, name: v.name, amount: amt, dayOfMonth: day, category: category.name } : t)
                  : (data.creditTemplate || []),
              });
            } else {
              const tid = uid();
              const newItem = { id: uid(), templateId: tid, name: v.name, amount: amt, dayOfMonth: day, category: category.name };
              save({
                ...data,
                creditCategories,
                months: { ...data.months, [targetKey]: { ...targetMonth, credits: [...(targetMonth.credits || []), newItem] } },
                creditTemplate: touchesTemplate
                  ? [...(data.creditTemplate || []), { id: tid, name: v.name, amount: amt, dayOfMonth: day, category: category.name }]
                  : (data.creditTemplate || []),
              });
            }
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "credit" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const editing = modal.editId ? (targetMonth.credits || []).find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Credit" : "Add Credit"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Amazon refund", defaultValue: editing?.name },
            { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Source", type: "category", categories: data.creditCategories || [], defaultValue: editing?.category || editing?.source },
            { key: "date", label: "Date", type: "date", defaultValue: editing?.date || `${targetKey}-01` },
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const amt = +v.amount;
            if (!v.name || !(amt > 0)) { setModal(null); return; }
            const { categories: creditCategories, category } = ensureCreditCategory(data.creditCategories || [], v.category);
            const nextCredits = editing
              ? (targetMonth.credits || []).map((x) => x.id === editing.id
                  ? { ...x, name: v.name, amount: amt, date: v.date, category: category.name }
                  : x)
              : [...(targetMonth.credits || []), { id: uid(), name: v.name, amount: amt, date: v.date, category: category.name }];
            save({
              ...data,
              creditCategories,
              months: { ...data.months, [targetKey]: { ...targetMonth, credits: nextCredits } },
            });
            setModal(null);
          }} />
        );
      })()}

      {settingsOpen && (
        <SettingsModal
          data={data}
          onClose={() => setSettingsOpen(false)}
          onChangeReminders={(reminders) => save({ ...data, reminders })}
        />
      )}
    </div>
    </DeleteArmContext.Provider>
    </ThemeContext.Provider>
  );
}

function makeStyles(theme) {
  const hairline = `1px solid ${theme.border}`;
  return {
    shell: { display: "flex", height: "100vh", background: theme.outerBg, color: theme.text, fontFamily: FONT, overflow: "hidden" },
    sidebar: { width: 240, minWidth: 240, background: theme.outerBg, borderRight: "none", display: "flex", flexDirection: "column", height: "100vh", overflowY: "auto", overflowX: "hidden" },
    logo: { padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.md}px`, borderBottom: `1px solid ${theme.outerBorder}`, flexShrink: 0 },
    nav: { padding: `${SPACE.sm}px ${SPACE.sm}px`, display: "flex", flexDirection: "column", gap: SPACE.xxs, flex: "1 0 auto" },
    navItem: { display: "flex", alignItems: "center", gap: SPACE.sm, padding: `${SPACE.xs}px ${SPACE.md}px`, borderRadius: RADIUS.md, border: "none", background: "transparent", color: theme.outerTextMuted, ...TYPE.caption, cursor: "pointer", fontFamily: FONT, textAlign: "left", width: "100%", flexShrink: 0, minHeight: 44, boxSizing: "border-box" },
    navItemActive: { background: theme.outerAccentSoft, color: theme.outerText, fontWeight: 600 },
    badge: { background: theme.warning, color: "#fff", ...TYPE.microLegal, fontWeight: 600, borderRadius: RADIUS.pill, padding: "2px 8px", marginLeft: "auto" },
    sidebarIncome: { padding: `${SPACE.md}px ${SPACE.lg}px`, borderTop: `1px solid ${theme.outerBorder}`, flexShrink: 0 },
    incomeInput: { background: "transparent", border: `1px solid ${theme.outerBorder}`, borderRadius: RADIUS.md, padding: `${SPACE.xs}px ${SPACE.sm}px`, color: theme.success, fontFamily: FONT, fontVariantNumeric: "tabular-nums", ...TYPE.bodyStrong, width: "100%", textAlign: "right", outline: "none", boxSizing: "border-box" },
    main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: theme.outerBg },
    topbar: { padding: `${SPACE.lg}px ${SPACE.xl}px ${SPACE.md}px`, borderBottom: "none", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, background: theme.outerBg },
    content: { flex: 1, overflow: "auto", background: theme.bg, borderRadius: RADIUS.lg, margin: `0 ${SPACE.md}px ${SPACE.md}px 0`, padding: SPACE.xl },
    contentInner: { maxWidth: 1440, margin: "0 auto" },
    // auto-fit, not a fixed 4: the row carries a 5th card once there are closed
    // months, which overflowed the grid and clipped off the right edge.
    statsRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: SPACE.md, marginBottom: SPACE.lg },
    statCard: { background: theme.surface, borderRadius: RADIUS.lg, padding: SPACE.lg, border: hairline, boxShadow: "none" },
    dashGrid: { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: SPACE.md },
    card: { background: theme.surface, borderRadius: RADIUS.lg, padding: SPACE.lg, border: hairline, boxShadow: "none" },
    cardTitle: { ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.8px", color: theme.textFaint, fontWeight: 600 },
    linkBtn: { background: "none", border: "none", color: theme.accent, ...TYPE.buttonUtility, cursor: "pointer", fontFamily: FONT, padding: `${SPACE.xs}px 0` },
    searchInput: { width: "100%", boxSizing: "border-box", height: 44, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: RADIUS.pill, padding: `0 ${SPACE.lg}px`, ...TYPE.caption, color: theme.text, outline: "none", marginBottom: SPACE.sm, fontFamily: FONT },
    dataLink: { background: "none", border: "none", color: theme.outerTextMuted, ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.6px", cursor: "pointer", fontFamily: FONT, fontWeight: 400, padding: `${SPACE.xs}px 0`, textAlign: "left" },
    breakdownBar: { display: "flex", height: SPACE.sm, borderRadius: RADIUS.pill, overflow: "hidden", background: theme.bg, marginTop: SPACE.sm },
    tableHeader: { display: "flex", padding: `${SPACE.sm}px ${SPACE.md}px`, borderBottom: hairline, marginTop: SPACE.md, ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.6px", color: theme.textFaint, fontWeight: 600 },
    tableRow: { display: "flex", alignItems: "center", padding: `${SPACE.md}px ${SPACE.md}px`, borderBottom: hairline, ...TYPE.caption },
    miniRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: `${SPACE.sm}px 0`, borderBottom: hairline },
    addBtn: { background: theme.accent, color: "#fff", border: "none", borderRadius: RADIUS.pill, padding: "11px 22px", ...TYPE.caption, fontWeight: 600, cursor: "pointer", fontFamily: FONT },
    themeToggle: { background: "transparent", border: "none", color: theme.outerText, fontSize: 17, cursor: "pointer", width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, padding: 0 },
    delBtn: { background: "none", border: "none", color: theme.textFaint, cursor: "pointer", ...TYPE.caption, padding: `${SPACE.xxs}px ${SPACE.xs}px` },
    editBtn: { background: "none", border: "none", color: theme.textMuted, cursor: "pointer", ...TYPE.caption, padding: `${SPACE.xxs}px ${SPACE.xs}px` },
    empty: { textAlign: "center", color: theme.textFaint, padding: `${SPACE.xxl}px ${SPACE.lg}px`, ...TYPE.body },
    emptySmall: { textAlign: "center", color: theme.textFaint, padding: `${SPACE.lg}px 0`, ...TYPE.caption },
    overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.32)", backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
    modal: { background: theme.surface, borderRadius: RADIUS.lg, padding: SPACE.xl, width: "100%", maxWidth: 460, border: hairline, boxShadow: ELEVATION },
    modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SPACE.xs },
    closeBtn: { background: "none", border: "none", color: theme.textFaint, fontSize: 20, cursor: "pointer", width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
    input: { width: "100%", background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, color: theme.text, ...TYPE.caption, outline: "none", boxSizing: "border-box", fontFamily: FONT, minHeight: 44 },
    saveBtn: { width: "100%", background: theme.accent, color: "#fff", border: "none", borderRadius: RADIUS.pill, padding: "14px 28px", ...TYPE.buttonLarge, cursor: "pointer", marginTop: SPACE.xs, fontFamily: FONT },
    catPill: { display: "inline-flex", alignItems: "center", gap: SPACE.xs, padding: `${SPACE.xxs}px ${SPACE.sm}px ${SPACE.xxs}px ${SPACE.xxs}px`, borderRadius: RADIUS.pill, ...TYPE.finePrint, fontWeight: 600 },
    catDot: { width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 },
    suggestBox: { position: "absolute", top: "100%", left: 0, right: 0, background: theme.surface, border: hairline, borderRadius: RADIUS.md, boxShadow: ELEVATION, zIndex: 10, maxHeight: 200, overflow: "auto", marginTop: SPACE.xxs },
    suggestItem: { display: "flex", alignItems: "center", gap: SPACE.sm, padding: `${SPACE.sm}px ${SPACE.sm}px`, cursor: "pointer", ...TYPE.caption },
    chartEmpty: { textAlign: "center", color: theme.textFaint, padding: `${SPACE.xxl}px ${SPACE.lg}px`, ...TYPE.caption },
    chartTooltip: { background: theme.surface, border: hairline, borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, ...TYPE.caption, color: theme.text, boxShadow: ELEVATION },
  };
}

const s = makeStyles(LIGHT_THEME);

const ThemeContext = createContext({ theme: LIGHT_THEME, s });
const useThemed = () => useContext(ThemeContext);