/* ---- Storage -------------------------------------------------------------
   Everything lives in one JSON document. In the browser that is localStorage;
   in the desktop app it is a real file under the OS app-data directory.

   The move off localStorage matters because a webview's storage is not durable
   - the OS may evict it under disk pressure, and clearing browser data for the
   WebView2 runtime takes it with it. Losing a year of finances that way is not
   an acceptable failure mode, and a file is also something you can copy, sync
   or inspect yourself.

   Kept behind the same tiny async get/set the app already used, so the app code
   above does not know or care which backing store it has. */

const STORE_FILE = "budget-ctrl.json";
const BACKUP_DIR = "backups";
const KEEP_BACKUPS = 14;
const LAST_BACKUP_KEY = "budget-ctrl-last-backup";

// Set when the file store is unreachable, so the failure is reportable instead
// of being hidden by the localStorage fallback.
let storageFault = null;
function getStorageFault() {
  return storageFault;
}

function noteStorageFault(where, err) {
  storageFault = `${where}: ${err && err.message ? err.message : String(err)}`;
  console.warn("[budget-ctrl] file storage unavailable —", storageFault);
}

async function fsApi() {
  const fs = await import("@tauri-apps/plugin-fs");
  return { fs, base: fs.BaseDirectory.AppData };
}

async function readStoreFile() {
  const { fs, base } = await fsApi();
  if (!(await fs.exists(STORE_FILE, { baseDir: base }))) return null;
  const text = await fs.readTextFile(STORE_FILE, { baseDir: base });
  if (!text || !text.trim()) return null;
  // Parse-check before handing it back. A truncated or corrupted file would
  // otherwise be returned happily, fail to parse in the caller, and present as
  // an empty app while the real data still sat in localStorage.
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !parsed.months) return null;
  } catch {
    return null;
  }
  return text;
}

// Write to a temporary file and move it into place, so a crash or power loss
// mid-write leaves the previous document intact rather than a truncated one.
// The app-data directory does not exist on a clean machine and writeTextFile
// will not create a missing parent, so the very first save would fail. Creating
// the backups folder recursively makes both it and its parent.
async function ensureStoreDir() {
  const { fs, base } = await fsApi();
  try {
    await fs.mkdir(BACKUP_DIR, { baseDir: base, recursive: true });
  } catch (err) {
    // "already exists" is fine; anything else is a real fault worth seeing.
    if (!/exist/i.test(String(err))) noteStorageFault("mkdir", err);
  }
}

async function writeStoreFile(text) {
  const { fs, base } = await fsApi();
  await ensureStoreDir();
  await fs.writeTextFile(STORE_FILE, text, { baseDir: base });
  // Read back rather than trust the call. The previous temp-file-and-rename
  // version reported success while leaving no file behind, and a write that
  // silently no-ops is indistinguishable from one that worked. Crash safety is
  // already covered by the daily backups and the localStorage mirror, so the
  // rename was complexity buying nothing.
  if (!(await fs.exists(STORE_FILE, { baseDir: base }))) {
    throw new Error("write reported success but the file does not exist");
  }
}

async function writeBackup(text, tag) {
  const { fs, base } = await fsApi();
  await ensureStoreDir();
  const stamp = new Date();
  const day = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
  const name = `${BACKUP_DIR}/budget-ctrl-${day}${tag ? `-${tag}` : ""}.json`;
  await fs.writeTextFile(name, text, { baseDir: base });
  await pruneBackups();
  return name;
}

async function listBackups() {
  if (!isTauri) return [];
  try {
    const { fs, base } = await fsApi();
    if (!(await fs.exists(BACKUP_DIR, { baseDir: base }))) return [];
    const entries = await fs.readDir(BACKUP_DIR, { baseDir: base });
    return entries
      .filter((e) => e.isFile && e.name.endsWith(".json"))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

async function pruneBackups() {
  try {
    const { fs, base } = await fsApi();
    const all = await listBackups();
    for (const name of all.slice(KEEP_BACKUPS)) {
      try { await fs.remove(`${BACKUP_DIR}/${name}`, { baseDir: base }); } catch { /* best effort */ }
    }
  } catch { /* pruning is housekeeping, never fatal */ }
}

async function readBackup(name) {
  const { fs, base } = await fsApi();
  return await fs.readTextFile(`${BACKUP_DIR}/${name}`, { baseDir: base });
}

// One backup per calendar day, plus an explicit one before anything
// destructive. Writing one on every keystroke would be noise.
async function maybeDailyBackup(text) {
  const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
  let last = null;
  try { last = localStorage.getItem(LAST_BACKUP_KEY); } catch { /* unavailable */ }
  if (last === today) return;
  try {
    await writeBackup(text);
    try { localStorage.setItem(LAST_BACKUP_KEY, today); } catch { /* unavailable */ }
  } catch { /* a failed backup must never block a save */ }
}

if (!window.storage) {
  window.storage = {
    get: async (key) => {
      if (isTauri) {
        try {
          const fromFile = await readStoreFile();
          if (fromFile) return { value: fromFile };
          // First run after upgrading: adopt whatever localStorage already
          // holds and write it to the file. localStorage is deliberately left
          // in place as a fallback rather than cleared.
          const legacy = localStorage.getItem(key);
          if (legacy) {
            try { await writeStoreFile(legacy); } catch { /* retried next save */ }
            return { value: legacy };
          }
          return null;
        } catch (err) {
          noteStorageFault("read", err);
          const val = localStorage.getItem(key);
          return val ? { value: val } : null;
        }
      }
      const val = localStorage.getItem(key);
      return val ? { value: val } : null;
    },
    set: async (key, value) => {
      if (isTauri) {
        try {
          await writeStoreFile(value);
          await maybeDailyBackup(value);
          // Mirrored to localStorage so a future read still finds the data if
          // the file is ever lost or unreadable.
          try { localStorage.setItem(key, value); } catch { /* quota */ }
          return { key, value };
        } catch (err) {
          noteStorageFault("write", err);
          localStorage.setItem(key, value);
          return { key, value };
        }
      }
      localStorage.setItem(key, value);
      return { key, value };
    },
  };
}
import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo, Fragment } from "react";
import { PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer, XAxis, YAxis, CartesianGrid, BarChart, Bar, AreaChart, Area } from "recharts";
import { renameCategory, deleteCategory, restyleCategory, countUsage, isFallback } from "./lib/categories.js";
import { budgetToCsv } from "./lib/csv.js";
import { FREQUENCIES, frequencyLabel, everyFromLabel, isOnCycle, nextOnCycle } from "./lib/schedule.js";
import { decodeBytes, sniffDelimiter, parseCsv, findHeaderRow, guessMapping, toTransactions, analyzeImport, applyImport, parseAmount } from "./lib/importer.js";
import {
  ACCOUNT_KINDS, STALE_DAYS, kindOf, sortedBalances, latestBalance, previousBalance, recordBalance, removeBalance,
  closeAccount, reopenAccount, netWorthAsOf, netWorthSeries, netWorthChange, staleAccounts, daysBetweenISO,
} from "./lib/accounts.js";
import { monthKey, currentMonthKey, monthLabel, periodKeyFor, currentPeriodKey, periodLabel, recurringDateInPeriod, isoDay } from "./lib/periods.js";
import { OVERDUE_GRACE_DAYS, upcomingSettled, collectDueBills, whenLabel } from "./lib/reminders.js";
import { periodSpending, periodIncome, creditReceived, categoryAverage } from "./lib/totals.js";
import { envelope, withCap, withRollover, startFresh } from "./lib/envelopes.js";
import { dueForCheck, progressPercent, describeUpdateError, agoLabel, notesToLines } from "./lib/updates.js";
import { rangeOptions, rangeKeys, comparisonFor, buildReport, categoryChanges, percentChange, reportToCsv, periodNoun, BASE_INCOME_NAME } from "./lib/reports.js";

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
// Wider than the auto-assignment palettes above, so a hand-picked style is not
// limited to what new categories cycle through.
const PICKER_COLORS = [...CATEGORY_COLORS, "#06b6d4", "#84cc16", "#a855f7", "#64748b", "#e11d48", "#0ea5e9"];
const PICKER_ICONS = [...CATEGORY_ICONS, "🎓", "🐾", "💡", "🏋️", "🍷", "🧾", "💳", "🚌", "👶", "🎵", "🛠️", "💼"];

const DEFAULT_CREDIT_CATEGORIES = [
  { name: "Refund", color: "#10b981", icon: "↩" },
  { name: "Gift",   color: "#ec4899", icon: "🎁" },
  { name: "Bonus",  color: "#f59e0b", icon: "⭐" },
  { name: "Salary", color: "#0066cc", icon: "💼" },
  { name: "Other",  color: "#9ca3af", icon: "·" },
];
const CREDIT_UNCATEGORIZED = { name: "Other", color: "#9ca3af", icon: "·" };

const STORAGE_KEY = "budget-app-data";
const UNDO_LIMIT = 50;

// Which tabs offer an "+ Add" CTA, what it is called, and which modal it opens.
// Previously three parallel inline ternaries in the header that had to be kept
// in sync by hand.
const ADD_LABELS = {
  expenses: "Expense",
  recurring: "Recurring",
  upcoming: "Payment",
  accounts: "Account",
};
const MODAL_FOR_TAB = { expenses: "expense", accounts: "account" };

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "◉" },
  { id: "duesoon", label: "Due Soon", icon: "!" },
  { id: "expenses", label: "Expenses", icon: "↗" },
  { id: "recurring", label: "Recurring", icon: "↻" },
  { id: "upcoming", label: "Upcoming", icon: "◈" },
  { id: "credits", label: "Credits", icon: "+" },
  { id: "history", label: "History", icon: "◷" },
  { id: "reports", label: "Reports", icon: "▦" },
  { id: "savings", label: "Savings", icon: "◆" },
  { id: "accounts", label: "Accounts", icon: "¤" },
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Currency was hardcoded to PLN, which made the app unusable outside Poland.
// It is held at module scope rather than passed down because fmt() is called
// from ~56 places, several of them plain functions outside the React tree;
// threading a parameter through all of them would add an argument to half the
// file to express a single global preference. App sets it on every render.
let activeCurrency = "PLN";
let activeLocale = (typeof navigator !== "undefined" && navigator.language) || "en-US";

function setMoneyFormat(currency, locale) {
  if (currency) activeCurrency = currency;
  if (locale) activeLocale = locale;
}

function currencyCode() {
  return activeCurrency;
}

function fmt(n) {
  try {
    return new Intl.NumberFormat(activeLocale, { style: "currency", currency: activeCurrency }).format(n);
  } catch {
    // An unrecognised code should degrade to a readable number, not throw and
    // take the whole screen down with it.
    return `${Number(n || 0).toFixed(2)} ${activeCurrency}`;
  }
}

// Whole units without the currency symbol, for dense tables whose heading
// already says what the numbers are.
function fmtWhole(n) {
  try {
    return new Intl.NumberFormat(activeLocale, { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n || 0));
  }
}

// A number as someone would type it back into a field: their decimal mark, no
// grouping, no currency. Prefilled inputs read "5800,5", not "5800.5".
function fmtPlain(n) {
  try {
    return new Intl.NumberFormat(activeLocale, { useGrouping: false, maximumFractionDigits: 2 }).format(n);
  } catch {
    return String(n);
  }
}

// Only a guess for a brand-new install, and always overridable in Settings.
// Intl has no region-to-currency mapping, so this covers the common cases
// rather than pretending to be exhaustive.
const REGION_CURRENCY = {
  PL: "PLN", GB: "GBP", US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD", CH: "CHF",
  SE: "SEK", NO: "NOK", DK: "DKK", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN",
  UA: "UAH", TR: "TRY", JP: "JPY", CN: "CNY", IN: "INR", BR: "BRL", MX: "MXN",
  ZA: "ZAR", SG: "SGD", HK: "HKD", KR: "KRW", IL: "ILS", AE: "AED",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR",
  IE: "EUR", PT: "EUR", FI: "EUR", GR: "EUR", SK: "EUR", SI: "EUR", EE: "EUR",
  LV: "EUR", LT: "EUR", LU: "EUR", CY: "EUR", MT: "EUR", HR: "EUR",
};

// Number grouping and decimal separators are a separate question from which
// currency you hold - a Pole holding euros still wants 1 234,56. Offered as a
// short list plus the system default rather than every locale Intl knows.
const LOCALE_OPTIONS = [
  { value: "", label: "System default" },
  { value: "en-US", label: "English (US) — 1,234.56" },
  { value: "en-GB", label: "English (UK) — 1,234.56" },
  { value: "pl-PL", label: "Polski — 1 234,56" },
  { value: "de-DE", label: "Deutsch — 1.234,56" },
  { value: "fr-FR", label: "Français — 1 234,56" },
  { value: "es-ES", label: "Español — 1.234,56" },
  { value: "it-IT", label: "Italiano — 1.234,56" },
  { value: "nl-NL", label: "Nederlands — 1.234,56" },
  { value: "sv-SE", label: "Svenska — 1 234,56" },
  { value: "cs-CZ", label: "Čeština — 1 234,56" },
  { value: "pt-BR", label: "Português (BR) — 1.234,56" },
  { value: "ja-JP", label: "日本語 — 1,234.56" },
];

function detectCurrency() {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return REGION_CURRENCY[region] || "USD";
  } catch {
    return "USD";
  }
}

function currencyOptions() {
  let codes;
  try {
    codes = Intl.supportedValuesOf("currency");
  } catch {
    codes = Object.values(REGION_CURRENCY).filter((c, i, a) => a.indexOf(c) === i).sort();
  }
  let names = null;
  try { names = new Intl.DisplayNames([activeLocale], { type: "currency" }); } catch { /* names are a nicety */ }
  return codes.map((code) => {
    let label = code;
    try { const n = names && names.of(code); if (n && n !== code) label = `${code} — ${n}`; } catch { /* keep the bare code */ }
    return { code, label };
  });
}

function emptyMonth() {
  return { income: 0, expenses: [], recurring: [], upcoming: [], credits: [] };
}

function defaultData() {
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

function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Local calendar date for filenames. toISOString() is UTC, so an export made
// just after midnight anywhere east of Greenwich was stamped with yesterday.
function fileDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function exportData(data) {
  downloadText(JSON.stringify(data, null, 2), `budget-ctrl-backup-${fileDate()}.json`, "application/json");
}

function exportCsv(data) {
  const csv = budgetToCsv(data, {
    resolveRecurringDate: (day, period) => isoDay(recurringDateInPeriod(day, period, data.cutoffDay || 1)),
    locale: data.locale || navigator.language,
    currency: data.currency,
  });
  downloadText(csv, `budget-ctrl-${fileDate()}.csv`, "text/csv;charset=utf-8");
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
    // Name, category and note, so "dentist" finds an entry named "Dr. Kowalski"
    // whose note says dentist.
    out = out.filter((x) => [x.name, x.category, x.note].some((f) => (f || "").toLowerCase().includes(q)));
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
function migrateAccounts(data) {
  return Array.isArray(data.accounts) ? data : { ...data, accounts: [] };
}

function hydrate(data) {
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
function categoryBreakdown(byCategory, categories) {
  return Array.from(byCategory.entries()).map(([name, value]) => {
    const cat = categories.find((c) => c.name === name) || { color: "#9ca3af", icon: "·" };
    return { name, value, color: cat.color, icon: cat.icon };
  }).sort((a, b) => b.value - a.value);
}

function monthlyTotals(data, today) {
  const cutoffDay = data.cutoffDay || 1;
  return Object.keys(data.months).sort().map((key) => {
    const m = data.months[key];
    return {
      key, label: monthLabel(key).slice(0, 3),
      spent: periodSpending(m, key, today, cutoffDay).total,
      income: periodIncome(m, key, today, cutoffDay).total,
    };
  });
}

function cumulativeSavings(data, today) {
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

function Modal({ title, onClose, children, width }) {
  const { s } = useThemed();
  // Escape closes, as every desktop dialog does. Inputs that use Escape for
  // their own purpose (reverting an inline edit) stop propagation first.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, ...(width ? { maxWidth: width } : null) }} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} style={s.closeBtn}>✕</button>
        </div>
        {/* Never taller than the window: the title stays put and the rest
            scrolls. Settings outgrew a small window and could not be read. */}
        <div style={s.modalBody}>{children}</div>
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

// Optional free text on any entry. Blank is stored as absent, not "".
function cleanNote(s) {
  const v = (s || "").trim();
  return v || undefined;
}

const NOTE_FIELD = (editing) => ({ key: "note", label: "Note", type: "textarea", placeholder: "Optional — reference, who, why", defaultValue: editing?.note });

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
          <div key={f.key} style={f.type === "checkbox" || f.type === "textarea" ? { gridColumn: "1 / -1" } : undefined}>
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
            ) : f.type === "textarea" ? (
              <textarea placeholder={f.placeholder} rows={2}
                value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                style={{ ...s.input, resize: "vertical", minHeight: 44, lineHeight: 1.4 }} />
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

// Name cell shared by every entry row: the name, any badge passed as children,
// and the note on a second line. The note is clipped to one line so a long one
// never changes row height; the full text is on hover.
function EntryName({ name, note, strike, every, children }) {
  const { theme } = useThemed();
  return (
    <div style={{ flex: 2, minWidth: 0 }}>
      <div style={{ fontWeight: 600, textDecoration: strike ? "line-through" : "none" }}>
        {name}
        {(every || 1) > 1 && (
          <span style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>{frequencyLabel(every).toLowerCase()}</span>
        )}
        {children}
      </div>
      {note && (
        <div title={note} style={{ ...TYPE.finePrint, lineHeight: 1.4, color: theme.textFaint, marginTop: 2,
                                   overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note}</div>
      )}
    </div>
  );
}

// Recurring bills or credits that exist in the template but fall in a later
// period. Without this they would vanish from view entirely between occurrences
// - a yearly bill set up in October would be invisible until March.
function NotDueThisPeriod({ items, curKey, cutoffDay, categories, fallback, positive, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  if (!items.length) return null;
  return (
    <div style={{ marginTop: SPACE.lg }}>
      <div style={{ ...s.cardTitle, marginBottom: SPACE.xxs }}>Not due this period</div>
      {items.map((tpl) => (
        <div key={tpl.id} style={{ ...s.tableRow, opacity: 0.8 }}>
          <EntryName name={tpl.name} note={tpl.note} />
          <div style={{ flex: 1.2 }}><CategoryPill categoryName={tpl.category} categories={categories} fallback={fallback} /></div>
          <div style={{ flex: 1.5, color: theme.textMuted, ...TYPE.caption }}>
            {frequencyLabel(tpl.every)} · next {periodLabel(nextOnCycle(tpl, curKey), cutoffDay).primary}
          </div>
          <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700,
                        color: positive ? theme.success : theme.accent }}>{positive ? "+" : ""}{fmt(tpl.amount)}</div>
          <RowActions id={`tpl-${tpl.id}`} onEdit={() => onEdit(tpl)} onDelete={() => onDelete(tpl)} />
        </div>
      ))}
    </div>
  );
}

// One row definition per entry type, used by the live tab and by History. They
// were duplicated character-for-character apart from which period the edit and
// delete callbacks targeted, so that is all the caller supplies.
function ExpenseRow({ entry: e, categories, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  return (
    <div style={s.tableRow}>
      <EntryName name={e.name} note={e.note} />
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
      <EntryName name={r.name} note={r.note} every={r.every}>
        {r.autoPay && <span title="Pays itself" style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>auto</span>}
      </EntryName>
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
      <EntryName name={u.name} note={u.note} strike={settled}>
        {u.autoPay && <span title="Pays itself" style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>auto</span>}
      </EntryName>
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

// Referenced by the storage shim at the top of the file, which is safe because
// those closures only run after this module has finished evaluating.
const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

async function getAppWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/* ---- Bill reminders ------------------------------------------------------
   The checker runs here, in the webview, rather than in Rust. Closing the
   window only hides it, so this keeps ticking in the tray, and it reuses the
   period math above instead of reimplementing cutoff-day arithmetic in a
   second language where it would drift silently. */

const REMINDER_SENT_KEY = "budget-ctrl-reminders-sent";
const REMINDER_INTERVAL_MS = 30 * 60 * 1000;
const REMINDER_STARTUP_DELAY_MS = 10 * 1000;
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

const UPDATE_CHECK_KEY = "budget-ctrl-last-update-check";

// Looks for a newer release on GitHub - shortly after launch, then at most once
// a day while the app sits in the tray - and installs it only when asked. The
// updater refuses anything not signed with the project's key.
function useUpdater(autoCheck, loaded) {
  const [status, setStatus] = useState({ phase: "idle" });
  const [update, setUpdate] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [version, setVersion] = useState("");
  const [lastChecked, setLastChecked] = useState(() => {
    try { return Number(localStorage.getItem(UPDATE_CHECK_KEY)) || null; } catch { return null; }
  });
  const updateRef = useRef(null);
  updateRef.current = update;

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then((v) => { if (alive) setVersion(v); })
      .catch(() => { /* version is cosmetic */ });
    return () => { alive = false; };
  }, []);

  const check = useCallback(async ({ quiet = false } = {}) => {
    if (!isTauri) return;
    setStatus({ phase: "checking" });
    try {
      const { check: findUpdate } = await import("@tauri-apps/plugin-updater");
      const found = await findUpdate();
      const at = Date.now();
      try { localStorage.setItem(UPDATE_CHECK_KEY, String(at)); } catch { /* unavailable */ }
      setLastChecked(at);
      if (found) {
        setUpdate(found);
        setDismissed(false);
        setStatus({ phase: "available" });
      } else {
        setStatus({ phase: "current" });
      }
    } catch (err) {
      // An automatic check that fails stays silent - being offline is not news -
      // and is retried on the next hourly tick.
      setStatus(quiet ? { phase: "idle" } : { phase: "error", message: describeUpdateError(err) });
    }
  }, []);

  useEffect(() => {
    if (!isTauri || !loaded || !autoCheck) return;
    const tick = () => {
      if (updateRef.current) return;
      let last = null;
      try { last = Number(localStorage.getItem(UPDATE_CHECK_KEY)) || null; } catch { /* unavailable */ }
      if (dueForCheck(last, Date.now())) check({ quiet: true });
    };
    // Not at the very moment of launch: starting up at login is busy enough.
    const first = setTimeout(tick, 15000);
    const hourly = setInterval(tick, 60 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(hourly); };
  }, [loaded, autoCheck, check]);

  const install = useCallback(async (beforeInstall) => {
    const found = updateRef.current;
    if (!found) return;
    setStatus({ phase: "downloading", percent: null });
    try {
      // Updates never touch the budget file, but a snapshot first is cheap.
      try { await beforeInstall?.(found.version); } catch { /* never block an update on it */ }
      let downloaded = 0;
      let total = null;
      let shown = -1;
      await found.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? null;
        else if (ev.event === "Progress") {
          downloaded += ev.data.chunkLength;
          const pct = progressPercent(downloaded, total);
          if (pct !== shown) { shown = pct; setStatus({ phase: "downloading", percent: pct }); }
        } else if (ev.event === "Finished") setStatus({ phase: "installing" });
      });
      // On Windows the installer closes the app and starts the new version
      // itself; this restart is for when it has not.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setStatus({ phase: "failed", message: describeUpdateError(err, "installing the update") });
    }
  }, []);

  return {
    supported: isTauri,
    version,
    status,
    lastChecked,
    update: update ? { version: update.version, notes: update.body || "" } : null,
    dismissed,
    dismiss: () => setDismissed(true),
    check,
    install,
  };
}

function UpdateBanner({ updater, onInstall }) {
  const { theme, s } = useThemed();
  const [notesOpen, setNotesOpen] = useState(false);
  const { status, update } = updater;
  const busy = status.phase === "downloading" || status.phase === "installing";
  if (!update || (updater.dismissed && !busy)) return null;
  const notes = notesToLines(update.notes);
  return (
    <div role="status" style={{
      ...TYPE.caption, background: `${theme.accent}12`, border: `1px solid ${theme.accent}40`,
      borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.md,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.md, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220, color: theme.text }}>
          {status.phase === "downloading"
            ? `Downloading Budget Ctrl ${update.version}…${status.percent != null ? ` ${status.percent}%` : ""}`
            : status.phase === "installing"
              ? `Installing Budget Ctrl ${update.version}. It will restart by itself.`
              : status.phase === "failed"
                ? `Couldn't install the update. ${status.message}`
                : <><strong>Budget Ctrl {update.version}</strong> is ready to install.</>}
        </div>
        {!busy && notes.length > 0 && (
          <button style={s.linkBtn} onClick={() => setNotesOpen(!notesOpen)}>{notesOpen ? "Hide" : "What's new"}</button>
        )}
        {!busy && (
          <button style={{ ...s.addBtn, padding: "7px 16px" }} onClick={onInstall}>
            {status.phase === "failed" ? "Try again" : "Install and restart"}
          </button>
        )}
        {!busy && <button style={s.linkBtn} onClick={updater.dismiss}>Later</button>}
      </div>
      {status.phase === "downloading" && (
        <div style={{ height: 4, background: theme.border, borderRadius: 2, overflow: "hidden", marginTop: SPACE.sm }}>
          <div style={{ height: "100%", width: `${status.percent ?? 100}%`, background: theme.accent,
                        opacity: status.percent == null ? 0.4 : 1, transition: "width .2s" }} />
        </div>
      )}
      {notesOpen && !busy && (
        <div style={{ marginTop: SPACE.sm, maxHeight: 260, overflowY: "auto", paddingRight: SPACE.xs }}>
          {notes.map((n, i) => (
            <div key={i} style={{
              ...TYPE.finePrint, lineHeight: 1.5,
              color: n.kind === "heading" ? theme.text : theme.textMuted,
              fontWeight: n.kind === "heading" ? 600 : 400,
              marginTop: n.kind === "heading" && i > 0 ? SPACE.sm : 2,
              paddingLeft: n.kind === "bullet" ? 14 : 0, textIndent: n.kind === "bullet" ? -10 : 0,
            }}>
              {n.kind === "bullet" ? "• " : ""}{n.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
        const { title, body } = buildDigest(bills);
        const { invoke } = await import("@tauri-apps/api/core");
        try {
          // Our own toast, which opens the app on the due list when clicked.
          await invoke("show_reminder", { title, body });
        } catch {
          // Not Windows, or the toast failed: a plain notification still beats
          // a silent missed bill.
          const n = await import("@tauri-apps/plugin-notification");
          let granted = await n.isPermissionGranted();
          if (!granted) granted = (await n.requestPermission()) === "granted";
          if (!granted || !alive) return;
          await n.sendNotification({ title, body });
        }
        writeSentMarker({ date: today, sig });
      } catch { /* Tauri API unavailable (browser dev server) */ }
    };

    // A clicked reminder opens the app at budgetctrl://due-soon. Rust brings
    // the window forward and says so here; if the click is what launched the
    // app, the page asks once it has loaded.
    let unlistenClick;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");
        unlistenClick = await listen("open-due-soon", () => {
          if (!alive) return;
          invoke("take_open_due_soon").catch(() => {});
          onReminderOpened();
        });
        if (alive && await invoke("take_open_due_soon")) onReminderOpened();
      } catch { /* Tauri API unavailable (browser dev server) */ }
    })();

    const onWindowFocus = () => tick();

    const startup = setTimeout(tick, REMINDER_STARTUP_DELAY_MS);
    const iv = setInterval(tick, REMINDER_INTERVAL_MS);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      alive = false;
      clearTimeout(startup);
      clearInterval(iv);
      window.removeEventListener("focus", onWindowFocus);
      if (unlistenClick) unlistenClick();
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

function CategoryRow({ cat, kind, data, onRename, onRestyle, onDelete }) {
  const { theme, s } = useThemed();
  const [draft, setDraft] = useState(cat.name);
  const [styling, setStyling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const locked = isFallback(kind, cat.name);
  const usage = countUsage(data, kind, cat.name);
  const listKey = kind === "spend" ? "categories" : "creditCategories";
  const others = (data[listKey] || []).filter((c) => c.name !== cat.name);

  // No prop-to-state sync needed: rows are keyed by name, so a rename that
  // lands remounts the row with a fresh draft. Only a rename that does NOT land
  // (a declined merge, or an error) has to put the old name back.
  const commit = () => {
    const next = draft.trim();
    if (!next || next === cat.name) { setDraft(cat.name); return; }
    if (!onRename(cat.name, next)) setDraft(cat.name);
  };

  const usageText = usage.entries || usage.templates
    ? `${usage.entries} entr${usage.entries === 1 ? "y" : "ies"}${usage.templates ? ` · ${usage.templates} recurring` : ""}`
    : "unused";

  return (
    <div style={{ borderBottom: `1px solid ${theme.border}`, padding: `${SPACE.xs}px 0` }}>
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
        <button
          onClick={() => !locked && setStyling((v) => !v)}
          title={locked ? undefined : "Change colour and icon"}
          style={{ ...s.catDot, width: 32, height: 32, border: "none", cursor: locked ? "default" : "pointer",
                   background: `${cat.color}25`, color: cat.color, fontSize: 15, flexShrink: 0 }}
        >{cat.icon}</button>
        {locked ? (
          <div style={{ flex: 1, ...TYPE.caption, color: theme.text }}>
            {cat.name}
            <span style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 8 }}>default — always kept</span>
          </div>
        ) : (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") { e.stopPropagation(); setDraft(cat.name); e.currentTarget.blur(); }
            }}
            className="inline-edit"
            style={{ flex: 1, background: "transparent", borderRadius: RADIUS.sm, padding: `${SPACE.xxs}px ${SPACE.xs}px`,
                     color: theme.text, ...TYPE.caption, fontFamily: FONT, outline: "none", minWidth: 0 }}
          />
        )}
        <span style={{ ...TYPE.finePrint, color: theme.textFaint, whiteSpace: "nowrap" }}>{usageText}</span>
        {!locked && (
          <button style={s.delBtn} title="Delete category" onClick={() => setDeleting((v) => !v)}>✕</button>
        )}
      </div>

      {styling && !locked && (
        <div style={{ padding: `${SPACE.xs}px 0 ${SPACE.xs}px 44px`, display: "flex", flexDirection: "column", gap: SPACE.xs }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PICKER_COLORS.map((c) => (
              <button key={c} onClick={() => onRestyle(cat.name, { color: c })} title={c}
                style={{ width: 22, height: 22, borderRadius: "50%", background: c, cursor: "pointer", padding: 0,
                         border: c === cat.color ? `2px solid ${theme.text}` : "2px solid transparent" }} />
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {PICKER_ICONS.map((ic) => (
              <button key={ic} onClick={() => onRestyle(cat.name, { icon: ic })}
                style={{ width: 30, height: 30, borderRadius: RADIUS.sm, cursor: "pointer", fontSize: 15, padding: 0,
                         background: ic === cat.icon ? theme.accentSoft : "transparent",
                         border: `1px solid ${ic === cat.icon ? theme.accent : theme.border}` }}>{ic}</button>
            ))}
          </div>
        </div>
      )}

      {deleting && !locked && (
        <div style={{ padding: `${SPACE.xs}px 0 ${SPACE.xs}px 44px`, display: "flex", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap" }}>
          {usage.entries || usage.templates ? (
            <>
              <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textMuted }}>Move its {usageText} to</span>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ ...s.input, width: 180, minHeight: 32, padding: "4px 8px" }}>
                <option value="">{kind === "spend" ? "Uncategorized" : "Other"}</option>
                {others.filter((c) => !isFallback(kind, c.name)).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </>
          ) : (
            <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textMuted }}>Nothing uses this category.</span>
          )}
          <button style={{ ...s.linkBtn, padding: 0, color: theme.danger }} onClick={() => onDelete(cat.name, moveTo)}>Delete</button>
          <button style={{ ...s.linkBtn, padding: 0, color: theme.textMuted }} onClick={() => setDeleting(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// Categories used to be created by typing a name into an entry form, with no
// way to rename, restyle or remove one afterwards - so a typo was permanent and
// every report inherited it. The data transforms live in lib/categories.js
// where they are unit-tested; this is only the surface over them.
function CategoryManager({ data, onClose, onChange }) {
  const { theme, s } = useThemed();
  const [kind, setKind] = useState("spend");
  const [newName, setNewName] = useState("");
  const listKey = kind === "spend" ? "categories" : "creditCategories";
  const list = data[listKey] || [];

  // Fallback first, then alphabetical, so the list is stable while editing.
  const ordered = [...list].sort((a, b) =>
    (isFallback(kind, b.name) - isFallback(kind, a.name)) || a.name.localeCompare(b.name));

  // Returns whether the change was applied, so a row can restore its input.
  const run = (fn) => {
    try { onChange(fn()); return true; } catch (err) { alert(err.message); return false; }
  };

  const onRename = (from, to) => {
    const target = list.find((c) => c.name.toLowerCase() === to.toLowerCase() && c.name !== from);
    if (target && !confirm(`Merge "${from}" into "${target.name}"?\n\nEverything in "${from}" moves to "${target.name}", and "${from}" is removed.`)) return false;
    return run(() => renameCategory(data, kind, from, to));
  };

  const onAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const ensure = kind === "spend" ? ensureCategory : ensureCreditCategory;
    const { categories } = ensure(list, name);
    onChange({ ...data, [listKey]: categories });
    setNewName("");
  };

  const segBtn = (value, label) => (
    <button onClick={() => setKind(value)} style={{
      flex: 1, border: "none", cursor: "pointer", borderRadius: RADIUS.pill, padding: "8px 12px",
      ...TYPE.caption, fontWeight: kind === value ? 600 : 400, fontFamily: FONT,
      background: kind === value ? theme.surface : "transparent",
      color: kind === value ? theme.text : theme.textMuted,
      boxShadow: kind === value ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
    }}>{label}</button>
  );

  return (
    <Modal title="Categories" onClose={onClose} width={560}>
      <div style={{ display: "flex", gap: 4, background: theme.bg, borderRadius: RADIUS.pill, padding: 4, margin: `${SPACE.xs}px 0 ${SPACE.sm}px` }}>
        {segBtn("spend", "Spending")}
        {segBtn("credit", "Income sources")}
      </div>
      <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginBottom: SPACE.xs }}>
        Rename by editing a name — renaming onto an existing one merges them. Click a badge to change its colour and icon.
      </div>
      <div style={{ maxHeight: "52vh", overflowY: "auto", paddingRight: 4 }}>
        {ordered.map((c) => (
          <CategoryRow key={`${kind}:${c.name}`} cat={c} kind={kind} data={data}
            onRename={onRename}
            onRestyle={(name, style) => run(() => restyleCategory(data, kind, name, style))}
            onDelete={(name, moveTo) => run(() => deleteCategory(data, kind, name, moveTo))}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: SPACE.sm, marginTop: SPACE.md }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
          placeholder={kind === "spend" ? "New spending category" : "New income source"}
          style={{ ...s.input, flex: 1 }} />
        <button style={{ ...s.addBtn, opacity: newName.trim() ? 1 : 0.5 }} disabled={!newName.trim()} onClick={onAdd}>Add</button>
      </div>
    </Modal>
  );
}

const ACTION_LABEL = { expense: "Expense", credit: "Credit", markPaid: "Marks paid", skip: "Skip" };

// Bank statement import. The parsing and the double-count matching live in
// lib/importer.js where they are tested; this is the wizard over them:
// pick a file, confirm what each column is, review every row, import.
function StatementImport({ data, onClose, onImport }) {
  const { theme, s } = useThemed();
  const [step, setStep] = useState("pick");
  const [file, setFile] = useState(null);       // { name, encoding, delimiter, rows, headerIndex }
  const [mapping, setMapping] = useState(null);
  const [splitAmounts, setSplitAmounts] = useState(false);
  const [invert, setInvert] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const { text, encoding } = decodeBytes(new Uint8Array(await f.arrayBuffer()));
      const delimiter = sniffDelimiter(text);
      const parsed = parseCsv(text, delimiter);
      if (parsed.length < 2) { setError("That file doesn't contain a table of transactions."); return; }
      const headerIndex = findHeaderRow(parsed);
      const m = guessMapping(parsed[headerIndex]);
      setFile({ name: f.name, encoding, delimiter, rows: parsed, headerIndex });
      setMapping(m);
      setSplitAmounts(m.amount < 0 && (m.debit >= 0 || m.credit >= 0));
      setInvert(false);
      setError("");
      setStep("map");
    } catch {
      setError("Couldn't read that file. Export a CSV from your bank and try again.");
    }
  };

  const header = file ? file.rows[file.headerIndex] : [];
  const effective = mapping && (splitAmounts ? { ...mapping, amount: -1 } : { ...mapping, debit: -1, credit: -1 });
  const preview = file && effective ? toTransactions(file.rows, file.headerIndex, effective, { invert }) : null;

  const col = (key, label) => (
    <SettingRow label={label}>
      <select value={mapping[key]} onChange={(e) => setMapping({ ...mapping, [key]: +e.target.value })}
        style={{ ...s.input, width: 230, minHeight: 36, padding: "6px 10px" }}>
        <option value={-1}>— none —</option>
        {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </select>
    </SettingRow>
  );

  const toReview = () => {
    setRows(analyzeImport(preview.transactions, data));
    setStep("review");
  };

  const toggle = (id) => setRows((rs) => rs.map((r) => {
    if (r.id !== id) return r;
    if (r.include) return { ...r, include: false };
    // Ticking a row the matcher skipped means "import it anyway".
    return r.action === "skip" ? { ...r, include: true, action: r.amount < 0 ? "expense" : "credit" } : { ...r, include: true };
  }));
  const setCategory = (id, category) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, category } : r)));
  const setAll = (include) => setRows((rs) => rs.map((r) =>
    include && r.action === "skip" ? r : { ...r, include: include && r.action !== "skip" }));

  const kept = rows.filter((r) => r.include);
  const tally = {
    expense: kept.filter((r) => r.action === "expense").length,
    credit: kept.filter((r) => r.action === "credit").length,
    markPaid: kept.filter((r) => r.action === "markPaid").length,
    skip: rows.length - kept.length,
  };

  const doImport = () => {
    let n = 0;
    const { data: next, counts } = applyImport(data, rows, () => `${uid()}${++n}`);
    onImport(next, counts);
  };

  const hint = { ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint };

  return (
    <Modal title="Import bank statement" onClose={onClose} width={step === "review" ? 820 : 560}>
      {step === "pick" && (
        <div style={{ padding: `${SPACE.sm}px 0` }}>
          <div style={{ ...TYPE.caption, color: theme.textMuted, lineHeight: 1.5, marginBottom: SPACE.md }}>
            Export your transactions from online banking as CSV, then choose the file. You'll check every
            row before anything is added.
          </div>
          <label style={{ ...s.addBtn, display: "inline-block" }}>
            Choose CSV file…
            <input type="file" accept=".csv,.txt,text/csv" onChange={onFile} style={{ display: "none" }} />
          </label>
          {error && <div style={{ ...TYPE.caption, color: theme.danger, marginTop: SPACE.sm }}>{error}</div>}
          <div style={{ ...hint, marginTop: SPACE.md }}>
            Payments already in your budget — recurring bills, your salary, things you entered by hand — are
            recognised and left unticked, so nothing is counted twice.
          </div>
        </div>
      )}

      {step === "map" && file && (
        <div>
          <div style={{ ...hint, marginBottom: SPACE.xs }}>
            {file.name} · {file.encoding === "utf-8" ? "UTF-8" : "Windows-1250"} · separated by{" "}
            {file.delimiter === "\t" ? "tabs" : `"${file.delimiter}"`} · {file.rows.length - file.headerIndex - 1} rows
          </div>
          {col("date", "Date")}
          {col("payee", "Name (who was paid)")}
          {col("title", "Description")}
          <SettingRow label="Amounts" hint={splitAmounts ? "Money out and money in are in separate columns." : "One column; spending is negative."}>
            <select value={splitAmounts ? "split" : "single"} onChange={(e) => setSplitAmounts(e.target.value === "split")}
              style={{ ...s.input, width: 230, minHeight: 36, padding: "6px 10px" }}>
              <option value="single">One amount column</option>
              <option value="split">Separate out / in columns</option>
            </select>
          </SettingRow>
          {splitAmounts ? (<>{col("debit", "Money out")}{col("credit", "Money in")}</>) : col("amount", "Amount")}
          {!splitAmounts && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, ...TYPE.caption, color: theme.text, padding: "6px 0" }}>
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} style={{ accentColor: theme.accent }} />
              My bank shows spending as positive numbers
            </label>
          )}

          <div style={{ ...s.cardTitle, marginTop: SPACE.md }}>Preview</div>
          {preview && preview.transactions.length ? (
            <div style={{ marginTop: SPACE.xs }}>
              {preview.transactions.slice(0, 5).map((tx, i) => (
                <div key={i} style={{ display: "flex", gap: SPACE.sm, ...TYPE.caption, padding: "4px 0", borderBottom: `1px solid ${theme.border}` }}>
                  <span style={{ color: theme.textMuted, width: 90, flexShrink: 0 }}>{tx.date}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.name}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: tx.amount < 0 ? theme.danger : theme.success }}>
                    {tx.amount < 0 ? "−" : "+"}{fmt(Math.abs(tx.amount))}
                  </span>
                </div>
              ))}
              <div style={{ ...hint, marginTop: 6 }}>
                {preview.transactions.length} transaction{preview.transactions.length !== 1 ? "s" : ""} read
                {preview.skipped ? ` · ${preview.skipped} row${preview.skipped !== 1 ? "s" : ""} without a date or amount ignored` : ""}
                {` · dates read as ${preview.dateOrder === "MDY" ? "month/day" : preview.dateOrder === "YMD" ? "year-month-day" : "day/month"}`}
              </div>
            </div>
          ) : (
            <div style={{ ...TYPE.caption, color: theme.danger, marginTop: SPACE.xs }}>
              No transactions found with these columns. Check which column holds the date and the amount.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: SPACE.lg }}>
            <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setStep("pick")}>← Choose another file</button>
            <button style={{ ...s.addBtn, opacity: preview?.transactions.length ? 1 : 0.5 }}
              disabled={!preview?.transactions.length} onClick={toReview}>Review transactions →</button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap", margin: `${SPACE.xs}px 0` }}>
            <div style={{ ...TYPE.caption, color: theme.textMuted }}>
              {tally.expense} expense{tally.expense !== 1 ? "s" : ""} · {tally.credit} credit{tally.credit !== 1 ? "s" : ""}
              {tally.markPaid ? ` · ${tally.markPaid} marked paid` : ""} · {tally.skip} skipped
            </div>
            <div style={{ display: "flex", gap: SPACE.md }}>
              <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setAll(true)}>Tick suggested</button>
              <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setAll(false)}>Untick all</button>
            </div>
          </div>
          <div style={{ maxHeight: "50vh", overflowY: "auto", borderTop: `1px solid ${theme.border}` }}>
            {rows.map((r) => {
              const cats = r.amount < 0 ? (data.categories || []) : (data.creditCategories || []);
              const fallbackCat = r.amount < 0 ? "Uncategorized" : "Other";
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: SPACE.sm, padding: "8px 0",
                                         borderBottom: `1px solid ${theme.border}`, opacity: r.include ? 1 : 0.55 }}>
                  <input type="checkbox" checked={r.include} onChange={() => toggle(r.id)} style={{ accentColor: theme.accent, width: 16, height: 16 }} />
                  <span style={{ ...TYPE.caption, color: theme.textMuted, width: 86, flexShrink: 0 }}>{r.date}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...TYPE.caption, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</div>
                    <div style={{ ...TYPE.microLegal, color: r.action === "skip" ? theme.textFaint : r.action === "markPaid" ? theme.success : theme.textFaint,
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason || r.note}>
                      {ACTION_LABEL[r.action]}{r.reason ? ` · ${r.reason}` : r.note ? ` · ${r.note}` : ""}
                    </div>
                  </div>
                  {(r.action === "expense" || r.action === "credit") ? (
                    <select value={r.category || fallbackCat} onChange={(e) => setCategory(r.id, e.target.value)}
                      disabled={!r.include} style={{ ...s.input, width: 150, minHeight: 32, padding: "4px 8px", ...TYPE.finePrint }}>
                      {[...new Set([fallbackCat, ...cats.map((c) => c.name)])].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  ) : <span style={{ width: 150 }} />}
                  <span style={{ width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, ...TYPE.caption,
                                 color: r.amount < 0 ? theme.danger : theme.success }}>
                    {r.amount < 0 ? "−" : "+"}{fmt(Math.abs(r.amount))}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: SPACE.md }}>
            <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setStep("map")}>← Columns</button>
            <button style={{ ...s.addBtn, opacity: kept.length ? 1 : 0.5 }} disabled={!kept.length} onClick={doImport}>
              Import {kept.length} item{kept.length !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Toast({ message }) {
  const { theme } = useThemed();
  if (!message) return null;
  return (
    <div role="status" style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 200,
      background: theme.text, color: theme.surface, borderRadius: RADIUS.pill, padding: "10px 18px",
      ...TYPE.caption, fontWeight: 600, boxShadow: ELEVATION, pointerEvents: "none",
    }}>{message}</div>
  );
}

function SettingsModal({ data, onClose, onChangeReminders, onChangeCurrency, onChangeLocale, onRestore, onManageCategories, updater, onChangeUpdates, onInstallUpdate }) {
  const { theme, s } = useThemed();
  const [openedAt] = useState(() => Date.now());
  const rem = data.reminders || { enabled: true, leadDays: 3 };
  // null until the plugin answers; the real registry entry is the source of
  // truth, so this is never persisted into `data` where it could desync.
  const [autostart, setAutostart] = useState(null);
  const [backups, setBackups] = useState([]);
  const [dataPath, setDataPath] = useState("");

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    (async () => {
      const names = await listBackups();
      if (alive) setBackups(names);
      try {
        const { appDataDir } = await import("@tauri-apps/api/path");
        const dir = await appDataDir();
        if (alive) setDataPath(dir);
      } catch { /* path API unavailable; the list alone is still useful */ }
    })();
    return () => { alive = false; };
  }, []);

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
      <div style={group}>Money</div>
      <SettingRow label="Currency" hint="Changes how every amount is displayed. It does not convert existing figures.">
        <select
          value={data.currency || "PLN"}
          onChange={(e) => onChangeCurrency(e.target.value)}
          style={{ ...s.input, width: 200 }}
        >
          {currencyOptions().map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
      </SettingRow>

      <SettingRow label="Number format" hint="How amounts are grouped and punctuated.">
        <select
          value={data.locale || ""}
          onChange={(e) => onChangeLocale(e.target.value)}
          style={{ ...s.input, width: 200 }}
        >
          {LOCALE_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </SettingRow>

      <SettingRow label="Categories" hint="Rename, merge, recolour or remove spending categories and income sources.">
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onManageCategories}>Manage…</button>
      </SettingRow>

      <div style={divider} />
      <div style={group}>Keyboard</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: SPACE.md, rowGap: 6, padding: `${SPACE.xs}px 0`, ...TYPE.caption }}>
        {[
          ["Ctrl+Z", "Undo"], ["Ctrl+Shift+Z / Ctrl+Y", "Redo"], ["Ctrl+1 … 0", "Switch tab"],
          ["N", "New entry on this tab"], ["/", "Search this tab"], ["Esc", "Close a dialog"],
        ].map(([k, v]) => (
          <Fragment key={k}>
            <kbd style={{ fontFamily: FONT, ...TYPE.finePrint, fontWeight: 600, color: theme.text, background: theme.bg,
                          border: `1px solid ${theme.border}`, borderRadius: RADIUS.xs, padding: "3px 7px", justifySelf: "start" }}>{k}</kbd>
            <span style={{ color: theme.textMuted, alignSelf: "center" }}>{v}</span>
          </Fragment>
        ))}
      </div>

      <div style={divider} />
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
      {rem.enabled && isTauri && (
        <SettingRow label="Test it" hint="Sends a reminder now. Clicking it should open the app on what's due.">
          <button style={s.linkBtn} onClick={async () => {
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("show_reminder", { title: "Budget Ctrl reminders are on", body: "Click here to see what's due." });
            } catch (err) {
              alert(`Windows didn't show the reminder: ${err}\n\nCheck that notifications are on for Budget Ctrl in Windows Settings → System → Notifications.`);
            }
          }}>Send a test reminder</button>
        </SettingRow>
      )}

      {isTauri && (
        <>
          <div style={divider} />
          <div style={group}>Data</div>
          {getStorageFault() && (
            <div style={{
              ...TYPE.caption, color: theme.danger, background: "rgba(239,68,68,0.1)",
              border: `1px solid ${theme.danger}`, borderRadius: RADIUS.md,
              padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.sm,
            }}>
              Could not write the data file, so this session is running on browser
              storage instead, which is less durable. Export a backup now.
              <span style={{ display: "block", ...TYPE.microLegal, marginTop: 4 }}>{getStorageFault()}</span>
            </div>
          )}
          <div style={{ ...TYPE.finePrint, lineHeight: 1.6, color: theme.textFaint, paddingBottom: SPACE.xs }}>
            Your budget is a single file on this machine. Nothing is sent anywhere.
            {dataPath && (
              <code style={{ display: "block", marginTop: 4, wordBreak: "break-all", color: theme.textMuted }}>{dataPath}</code>
            )}
          </div>
          <SettingRow
            label={backups.length ? `${backups.length} backup${backups.length !== 1 ? "s" : ""}` : "No backups yet"}
            hint="Taken once a day, and before any import. The newest 14 are kept."
          >
            {backups.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) { onRestore(e.target.value); e.target.value = ""; } }}
                style={{ ...s.input, width: 220 }}
              >
                <option value="">Restore from…</option>
                {backups.map((b) => <option key={b} value={b}>{b.replace(/^budget-ctrl-|\.json$/g, "")}</option>)}
              </select>
            )}
          </SettingRow>

          <div style={divider} />
          <div style={group}>Updates</div>
          <SettingRow label="Check for updates automatically" hint="Once a day. Nothing installs until you say so.">
            <Switch checked={data.updates?.auto !== false} onChange={(v) => onChangeUpdates({ ...(data.updates || {}), auto: v })} />
          </SettingRow>
          {(() => {
            const { status, update, lastChecked } = updater;
            const busy = status.phase === "downloading" || status.phase === "installing";
            const hint = status.phase === "checking" ? "Checking…"
              : status.phase === "current" ? "You're up to date."
              : status.phase === "error" || status.phase === "failed" ? status.message
              : status.phase === "downloading" ? `Downloading ${update?.version}…${status.percent != null ? ` ${status.percent}%` : ""}`
              : status.phase === "installing" ? "Installing. Budget Ctrl will restart."
              : update ? `Version ${update.version} is available.`
              : lastChecked ? `Last checked ${agoLabel(lastChecked, openedAt)}.`
              : "Not checked yet.";
            return (
              <SettingRow label={updater.version ? `Budget Ctrl ${updater.version}` : "Budget Ctrl"} hint={hint}>
                {update && !busy ? (
                  <button style={{ ...s.addBtn, padding: "7px 16px" }} onClick={onInstallUpdate}>Install {update.version}</button>
                ) : (
                  <button style={{ ...s.linkBtn, opacity: status.phase === "checking" || busy ? 0.5 : 1 }}
                    disabled={status.phase === "checking" || busy} onClick={() => updater.check()}>
                    Check now
                  </button>
                )}
              </SettingRow>
            );
          })()}

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

// Two-digit alpha suffix for a #rrggbb colour.
function alphaHex(a) {
  return Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
}

function shortPeriod(key, withYear) {
  const m = monthLabel(key).slice(0, 3);
  return withYear ? `${m} ’${key.slice(2, 4)}` : m;
}

// Category by period. Each cell is shaded by where it sits between its own
// row's quietest and busiest period, so a category's rhythm shows at a glance
// whatever its size - and a bill that never changes stays pale instead of
// lighting up the whole row.
function CategoryTrends({ report, categories, curKey, onOpenPeriod }) {
  const { theme } = useThemed();
  const withYear = report.keys.length > 0 && report.keys[0].slice(0, 4) !== report.keys[report.keys.length - 1].slice(0, 4);
  const line = `1px solid ${theme.border}`;
  const th = { ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.6px", color: theme.textFaint, fontWeight: 600,
               padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", borderBottom: line };
  const td = { ...TYPE.caption, padding: "8px 10px", textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums",
               whiteSpace: "nowrap", borderBottom: line };
  // The category column stays put while the periods scroll sideways.
  const sticky = { position: "sticky", left: 0, background: theme.surface, zIndex: 1, textAlign: "left" };
  const footer = [
    { label: "Spent", values: report.periods.map((p) => p.spent), total: report.spent, avg: report.averageSpent, color: () => theme.text },
    { label: "Income", values: report.periods.map((p) => p.income), total: report.income, avg: report.averageIncome, color: () => theme.text },
    { label: "Saved", values: report.periods.map((p) => p.income - p.spent), total: report.saved, avg: report.averageSaved,
      color: (v) => (v >= 0 ? "#10b981" : "#ef4444") },
  ];
  return (
    <div style={{ overflowX: "auto", marginTop: SPACE.md }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, ...sticky }}>Category</th>
            {report.keys.map((k) => (
              <th key={k} style={th}>
                <button onClick={() => onOpenPeriod(k)}
                  title={k === curKey ? "Still running · open on the Dashboard" : "Open in History"}
                  style={{ all: "unset", cursor: "pointer" }}>
                  {shortPeriod(k, withYear)}{k === curKey ? " •" : ""}
                </button>
              </th>
            ))}
            <th style={th}>Total</th>
            <th style={th} title={report.averagedOver < report.keys.length ? "Completed periods only" : undefined}>Avg</th>
          </tr>
        </thead>
        <tbody>
          {report.categories.map((row) => {
            const cat = findCategory(categories, row.name) || { name: row.name, color: "#9ca3af", icon: "·" };
            // Scaled on completed periods: a half-finished month is always low
            // and would make every full one look busy.
            const settled = row.perPeriod.filter((_, i) => report.keys[i] !== curKey);
            const scale = settled.length ? settled : row.perPeriod;
            const lo = Math.min(...scale);
            const hi = Math.max(...scale);
            const shade = (v) => `${cat.color}${alphaHex(0.06 + (hi > lo ? 0.24 * Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0))}`;
            return (
              <tr key={row.name}>
                <td style={{ ...td, ...sticky }}>
                  <CategoryPill categoryName={row.name} categories={categories} fallback={cat} />
                </td>
                {row.perPeriod.map((v, i) => (
                  <td key={report.keys[i]} style={{
                    ...td, color: v ? theme.text : theme.textFaint,
                    background: v > 0 ? shade(v) : "transparent",
                  }}>{v ? fmtWhole(v) : "–"}</td>
                ))}
                <td style={{ ...td, fontWeight: 700 }}>{fmtWhole(row.total)}</td>
                <td style={{ ...td, color: theme.textMuted }}>{fmtWhole(row.average)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {footer.map((f) => (
            <tr key={f.label}>
              <td style={{ ...td, ...sticky, fontWeight: 600, color: theme.textMuted, fontFamily: FONT }}>{f.label}</td>
              {f.values.map((v, i) => (
                <td key={report.keys[i]} style={{ ...td, fontWeight: 600, color: f.color(v) }}>{fmtWhole(v)}</td>
              ))}
              <td style={{ ...td, fontWeight: 700, color: f.color(f.total) }}>{fmtWhole(f.total)}</td>
              <td style={{ ...td, color: theme.textMuted }}>{fmtWhole(f.avg)}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

function ReportsView({ data, today, curKey, range, onRange, onOpenPeriod }) {
  const { theme, s } = useThemed();
  const cutoffDay = data.cutoffDay || 1;
  const options = rangeOptions(data, curKey);
  const rangeId = options.some((o) => o.id === range) ? range : (options[0]?.id || `year:${curKey.slice(0, 4)}`);
  const keys = rangeKeys(data, rangeId, curKey);
  // Averages and comparisons use completed periods only - half a month always
  // looks thrifty. The headline totals still include the running one.
  const report = buildReport(data, keys, today, { runningKey: curKey });
  const running = keys.includes(curKey);
  const one = periodNoun(cutoffDay, 1);
  const cmp = comparisonFor(data, rangeId, curKey);
  const nowCmp = cmp ? buildReport(data, cmp.closed, today) : null;
  const beforeCmp = cmp ? buildReport(data, cmp.keys, today) : null;
  const changes = cmp ? categoryChanges(nowCmp, beforeCmp).slice(0, 6) : [];
  const perPeriod = (r, field) => (r.keys.length ? r[field] / r.keys.length : 0);
  const vs = (field) => {
    if (!cmp) return null;
    const d = percentChange(perPeriod(nowCmp, field), perPeriod(beforeCmp, field));
    if (d == null) return null;
    return `${d >= 0 ? "↑" : "↓"} ${Math.abs(d * 100).toFixed(0)}% a ${one} vs ${cmp.label}`;
  };

  const exportReport = () => {
    const csv = reportToCsv(report, {
      locale: data.locale || navigator.language,
      label: (k) => periodLabel(k, cutoffDay).primary,
    });
    downloadText(csv, `budget-ctrl-report-${rangeId.replace(":", "-")}-${fileDate()}.csv`, "text/csv;charset=utf-8");
  };

  const span = keys.length
    ? `${monthLabel(keys[0])}${keys.length > 1 ? ` – ${monthLabel(keys[keys.length - 1])}` : ""} · ${keys.length} ${periodNoun(cutoffDay, keys.length)} tracked`
      + (running ? ` · ${monthLabel(curKey).split(" ")[0]} still running` : "")
    : "";

  const year = rangeId.startsWith("year:") ? rangeId.slice(5) : null;
  const multiYear = keys.length > 0 && keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4);
  const byKey = new Map(report.periods.map((p) => [p.key, p]));
  // A calendar year always shows January to December, so a gap reads as a gap.
  const bars = (year
    ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)
    : keys
  ).map((k) => ({ key: k, label: shortPeriod(k, multiYear), spent: byKey.get(k)?.spent || 0, income: byKey.get(k)?.income || 0 }));

  const catDonut = categoryBreakdown(new Map(report.categories.map((c) => [c.name, c.total])), data.categories || []);
  const incomeDonut = report.incomeSources.map(({ name, value }) => {
    if (name === BASE_INCOME_NAME) return { name, value, color: "#0066cc", icon: "💼" };
    const cat = (data.creditCategories || []).find((c) => c.name === name) || CREDIT_UNCATEGORIZED;
    return { name, value, color: cat.color, icon: cat.icon };
  });
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16 };
  const money = { fontFamily: FONT, fontVariantNumeric: "tabular-nums" };
  const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const shortDate = (iso) => {
    const d = iso ? new Date(`${iso}T00:00:00`) : null;
    return d && !isNaN(d) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: SPACE.md, marginBottom: SPACE.md, flexWrap: "wrap" }}>
        <div>
          <select aria-label="Report range" value={rangeId} onChange={(e) => onRange(e.target.value)}
            style={{ ...s.input, width: "auto", minWidth: 220, fontWeight: 600 }}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {span && <div style={{ ...TYPE.finePrint, color: theme.textMuted, marginTop: 6 }}>{span}</div>}
        </div>
        {keys.length > 0 && <button style={s.linkBtn} onClick={exportReport} title="Category by period, as a spreadsheet">Export CSV</button>}
      </div>

      {keys.length === 0 ? (
        <div style={s.empty}>Nothing recorded in this range.</div>
      ) : (
        <>
          <div style={s.statsRow}>
            <StatCard label="Income" value={fmt(report.income)} accent="#10b981"
              sub={vs("income") || "Base income and credits received"} icon="↑" />
            <StatCard label="Spent" value={fmt(report.spent)} accent="#ef4444"
              sub={vs("spent") || (running ? "Everything paid so far" : "Everything paid")} icon="↻" />
            <StatCard label="Saved" value={fmt(report.saved)} accent={report.saved >= 0 ? "#10b981" : "#ef4444"}
              sub={report.savingsRate == null ? "No income recorded" : `${Math.round(report.savingsRate * 100)}% of income`} icon="↓" />
            <StatCard label={`Avg per ${one}`} value={fmt(report.averageSpent)} accent="#0066cc"
              sub={`Spent, over ${report.averagedOver}${running && report.averagedOver < keys.length ? " completed" : ""} ${periodNoun(cutoffDay, report.averagedOver)}`} icon="◐" />
          </div>

          <div style={s.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: SPACE.md }}>
              <div style={s.cardTitle}>Spent each {one}</div>
              <div style={{ ...TYPE.finePrint, color: theme.textFaint }}>Red where spending passed income</div>
            </div>
            <MonthlyBarChart data={bars} curKey={curKey} onBarClick={onOpenPeriod} />
          </div>

          <div style={{ ...s.card, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: SPACE.md }}>
              <div style={s.cardTitle}>Spending by category</div>
              <div style={{ ...TYPE.finePrint, color: theme.textFaint }}>In {data.currency || currencyCode()} · click a {one} to open it</div>
            </div>
            {report.categories.length === 0
              ? <div style={s.emptySmall}>Nothing spent in this range.</div>
              : <CategoryTrends report={report} categories={data.categories || []} curKey={curKey} onOpenPeriod={onOpenPeriod} />}
          </div>

          <div style={grid}>
            <div style={s.card}>
              <div style={s.cardTitle}>What changed{cmp ? ` · vs ${cmp.label}` : ""}</div>
              {!cmp ? (
                <div style={s.emptySmall}>Nothing earlier to compare with yet.</div>
              ) : changes.length === 0 ? (
                <div style={s.emptySmall}>No category moved.</div>
              ) : (
                <>
                  {changes.map((c) => {
                    const up = c.delta > 0;
                    return (
                      <div key={c.name} style={{ ...s.tableRow, gap: SPACE.md }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <CategoryPill categoryName={c.name} categories={data.categories || []}
                            fallback={{ name: c.name, color: "#9ca3af", icon: "·" }} />
                          <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: 4, ...money }}>
                            {fmt(c.now)} a {one}, was {fmt(c.before)}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", whiteSpace: "nowrap", ...money }}>
                          <div style={{ fontWeight: 700, color: up ? "#ef4444" : "#10b981" }}>{up ? "↑" : "↓"} {fmt(Math.abs(c.delta))}</div>
                          {c.pct != null && <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: 2 }}>{up ? "+" : "−"}{Math.abs(c.pct * 100).toFixed(0)}%</div>}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: SPACE.sm }}>
                    Average per {one}, completed {periodNoun(cutoffDay)} only.
                  </div>
                </>
              )}
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>Where it went</div>
              <CategoryDonut data={catDonut} total={report.spent} />
            </div>
          </div>

          <div style={grid}>
            <div style={s.card}>
              <div style={s.cardTitle}>Biggest one-off payments</div>
              {report.biggest.length === 0 ? (
                <div style={s.emptySmall}>No one-off payments in this range.</div>
              ) : (
                report.biggest.map(({ entry, periodKey }) => (
                  <div key={`${periodKey}-${entry.id}`} style={{ ...s.tableRow, gap: SPACE.md }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...ellipsis, fontWeight: 600 }} title={entry.name}>{entry.name}</div>
                      <div style={{ ...ellipsis, ...TYPE.finePrint, color: theme.textFaint, marginTop: 2 }}>
                        {entry.category || "Uncategorized"} · {shortDate(entry.date || entry.dueDate)}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, color: "#ef4444", whiteSpace: "nowrap", ...money }}>{fmt(entry.amount)}</div>
                  </div>
                ))
              )}
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>Top payees</div>
              {report.payees.length === 0 ? (
                <div style={s.emptySmall}>No payments in this range.</div>
              ) : (
                <>
                  {report.payees.map((p) => (
                    <div key={p.key} style={{ ...s.tableRow, gap: SPACE.md }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...ellipsis, fontWeight: 600 }} title={p.name}>{p.name}</div>
                        <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: 2 }}>
                          {p.count} payment{p.count !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, whiteSpace: "nowrap", ...money }}>{fmt(p.total)}</div>
                    </div>
                  ))}
                  <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: SPACE.sm }}>
                    Same name, ignoring store numbers and capitals.
                  </div>
                </>
              )}
            </div>
          </div>

          <div style={grid}>
            <div style={s.card}>
              <div style={s.cardTitle}>Income sources</div>
              <CategoryDonut data={incomeDonut} total={report.income} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function NetWorthChart({ series }) {
  const { theme, s } = useThemed();
  if (series.length < 2) {
    return <div style={s.chartEmpty}>Update a balance on another day to see the trend.</div>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.accent} stopOpacity={0.3} />
              <stop offset="100%" stopColor={theme.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.label}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.text }}>Net worth: {fmt(d.net)}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.textMuted }}>Assets {fmt(d.assets)} · Debts {fmt(d.debts)}</div>
              </div>
            );
          }} />
          <Area type="monotone" dataKey="net" stroke={theme.accent} strokeWidth={2} fill="url(#netWorthFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function dayLabel(iso, withYear = true) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", withYear
    ? { day: "numeric", month: "short", year: "numeric" }
    : { day: "numeric", month: "short" });
}

function updatedLabel(days, iso) {
  if (days <= 0) return "updated today";
  if (days === 1) return "updated yesterday";
  if (days < 60) return `updated ${days} days ago`;
  return `updated ${dayLabel(iso)}`;
}

// Balances are typed in, not derived: the quickest path is the point, so
// updating one is a single field on the row, Enter to save.
function AccountsView({ accounts, todayISO, onAdd, onEdit, onRecord, onRemoveBalance }) {
  const { theme, s } = useThemed();
  const [updating, setUpdating] = useState(null);
  const [draft, setDraft] = useState({ amount: "", date: todayISO });
  const [expanded, setExpanded] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const money = { fontFamily: FONT, fontVariantNumeric: "tabular-nums" };
  const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  if (!accounts.length) {
    return (
      <div style={{ ...s.card, textAlign: "center", padding: SPACE.xxl }}>
        <div style={{ ...TYPE.lead, fontWeight: 600, marginBottom: SPACE.xs }}>Your accounts, in one place</div>
        <div style={{ ...TYPE.caption, color: theme.textMuted, maxWidth: 440, margin: "0 auto", lineHeight: 1.5 }}>
          Add your current account, savings, cash, cards and loans, and type in each balance when you check it.
          You'll see your net worth and how it moves over time.
        </div>
        <button style={{ ...s.addBtn, marginTop: SPACE.lg }} onClick={onAdd}>+ Add account</button>
      </div>
    );
  }

  const open = accounts.filter((a) => !a.closed);
  const assets = open.filter((a) => !kindOf(a).liability);
  const debts = open.filter((a) => kindOf(a).liability);
  const closed = accounts.filter((a) => a.closed);
  const worth = netWorthAsOf(accounts, todayISO);
  const change = netWorthChange(accounts, todayISO, 30);
  const stale = staleAccounts(accounts, todayISO);
  const series = netWorthSeries(accounts).map((p) => ({ ...p, label: dayLabel(p.date, false) }));

  const startUpdate = (a) => {
    const last = latestBalance(a);
    setUpdating(a.id);
    setDraft({ amount: last ? fmtPlain(last.amount) : "", date: todayISO });
  };
  const draftAmount = parseAmount(draft.amount);
  const commit = () => {
    if (draftAmount == null || !draft.date) return;
    onRecord(updating, { date: draft.date, amount: draftAmount });
    setUpdating(null);
  };

  const row = (a) => {
    const kind = kindOf(a);
    const last = latestBalance(a);
    const prev = previousBalance(a);
    const delta = last && prev ? last.amount - prev.amount : null;
    // Owing less is the good direction for a card or loan.
    const good = delta == null ? null : (kind.liability ? delta < 0 : delta > 0);
    const age = last ? daysBetweenISO(last.date, todayISO) : null;
    const isStale = !a.closed && (age == null || age > STALE_DAYS);
    const isUpdating = updating === a.id;
    const history = sortedBalances(a).reverse();
    return (
      <div key={a.id} style={{ borderBottom: `1px solid ${theme.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: SPACE.md, padding: "14px 0" }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: theme.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{kind.icon}</div>
          <button onClick={() => setExpanded(expanded === a.id ? null : a.id)} title="Show balance history"
            style={{ all: "unset", cursor: "pointer", flex: 1, minWidth: 0 }}>
            <div style={{ ...ellipsis, fontWeight: 600, color: a.closed ? theme.textMuted : theme.text }}>{a.name}</div>
            <div style={{ ...TYPE.finePrint, color: isStale ? theme.warning : theme.textFaint, marginTop: 2, ...ellipsis }}>
              {kind.label} · {a.closed ? "closed" : last ? updatedLabel(age, last.date) : "no balance yet"}
            </div>
          </button>
          {isUpdating ? (
            <div style={{ display: "flex", alignItems: "center", gap: SPACE.xs, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <input autoFocus inputMode="decimal" aria-label={kind.liability ? `Amount owed on ${a.name}` : `Balance of ${a.name}`}
                value={draft.amount} placeholder={kind.liability ? "Owed" : "Balance"}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { e.stopPropagation(); setUpdating(null); } }}
                style={{ ...s.input, width: 120, minHeight: 34, padding: "6px 10px", textAlign: "right" }} />
              <input type="date" aria-label="As of" value={draft.date} max={todayISO}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                style={{ ...s.input, width: 140, minHeight: 34, padding: "6px 10px" }} />
              <button style={{ ...s.editBtn, opacity: draftAmount == null ? 0.4 : 1 }} disabled={draftAmount == null} onClick={commit} title="Save (Enter)">✓</button>
              <button style={s.delBtn} onClick={() => setUpdating(null)} title="Cancel (Esc)">✕</button>
            </div>
          ) : (
            <>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ ...money, fontWeight: 700, color: kind.liability && last?.amount > 0 ? theme.danger : theme.text }}>
                  {last ? fmt(last.amount) : "—"}
                </div>
                {delta != null && delta !== 0 && (
                  <div style={{ ...TYPE.finePrint, ...money, color: good ? theme.success : theme.danger, marginTop: 2 }}
                    title={`Since ${dayLabel(prev.date)}`}>
                    {delta > 0 ? "↑" : "↓"} {fmt(Math.abs(delta))}
                  </div>
                )}
              </div>
              {!a.closed && <button style={s.linkBtn} onClick={() => startUpdate(a)}>Update</button>}
              <button style={s.editBtn} onClick={() => onEdit(a)} title="Edit account">✎</button>
            </>
          )}
        </div>
        {expanded === a.id && (
          <div style={{ padding: `0 0 ${SPACE.md}px 50px` }}>
            {history.length === 0 ? (
              <div style={{ ...TYPE.finePrint, color: theme.textFaint }}>No balances recorded.</div>
            ) : history.map((b, i) => {
              const older = history[i + 1];
              const d = older ? b.amount - older.amount : null;
              const up = d != null && (kind.liability ? d < 0 : d > 0);
              return (
                <div key={b.date} style={{ display: "flex", alignItems: "center", gap: SPACE.md, padding: "6px 0", ...TYPE.caption }}>
                  <div style={{ flex: 1, color: theme.textMuted }}>{dayLabel(b.date)}</div>
                  <div style={{ ...money, width: 110, textAlign: "right" }}>{fmt(b.amount)}</div>
                  <div style={{ ...money, width: 110, textAlign: "right", ...TYPE.finePrint, color: d == null || d === 0 ? theme.textFaint : up ? theme.success : theme.danger }}>
                    {d == null ? "first" : d === 0 ? "no change" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`}
                  </div>
                  <button style={s.delBtn} title="Remove this balance" onClick={() => onRemoveBalance(a.id, b.date)}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const group = (title, list, total) => list.length > 0 && (
    <div style={{ ...s.card, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={s.cardTitle}>{title}</div>
        <div style={{ ...TYPE.caption, ...money, fontWeight: 700, color: theme.textMuted }}>{fmt(total)}</div>
      </div>
      {list.map(row)}
    </div>
  );

  return (
    <>
      {stale.length > 0 && (
        <div style={{ ...TYPE.caption, background: `${theme.warning}18`, color: theme.text, border: `1px solid ${theme.warning}55`,
                      borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.md }}>
          {stale.map((a) => a.name).join(", ")} {stale.length === 1 ? "hasn't" : "haven't"} been updated in over a month.
        </div>
      )}
      <div style={s.statsRow}>
        <StatCard label="Net worth" value={fmt(worth.net)} accent={worth.net >= 0 ? "#10b981" : "#ef4444"}
          sub={change == null ? "What you own, less what you owe"
            : change === 0 ? "No change in 30 days"
            : `${change > 0 ? "↑" : "↓"} ${fmt(Math.abs(change))} in 30 days`} icon="¤" />
        <StatCard label="Assets" value={fmt(worth.assets)} accent="#0066cc"
          sub={`${assets.length} account${assets.length !== 1 ? "s" : ""}`} icon="↑" />
        <StatCard label="Debts" value={fmt(worth.debts)} accent="#ef4444"
          sub={debts.length ? `${debts.length} card${debts.length !== 1 ? "s" : ""} or loan${debts.length !== 1 ? "s" : ""}` : "None recorded"} icon="↓" />
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>Net worth over time</div>
        <NetWorthChart series={series} />
      </div>

      {group("Assets", assets, worth.assets)}
      {group("Debts · what you owe", debts, worth.debts)}

      {closed.length > 0 && (
        <div style={{ marginTop: SPACE.md }}>
          <button style={s.linkBtn} onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? "Hide" : "Show"} closed accounts ({closed.length})
          </button>
          {showClosed && <div style={{ ...s.card, marginTop: SPACE.sm }}>{closed.map(row)}</div>}
        </div>
      )}
    </>
  );
}

function AccountModal({ account, todayISO, onDismiss, onSave, onSetClosed, onDelete }) {
  const { theme, s } = useThemed();
  const editing = !!account;
  const [name, setName] = useState(account?.name || "");
  const [kind, setKind] = useState(account?.kind || "current");
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(todayISO);
  const [armDelete, setArmDelete] = useState(false);
  const amount = parseAmount(balance);
  const liability = ACCOUNT_KINDS.find((k) => k.id === kind)?.liability;
  const valid = !!name.trim() && (editing || (amount != null && !!date));
  const label = { fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 };
  return (
    <Modal title={editing ? "Edit Account" : "Add Account"} onClose={onDismiss}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "20px 0 12px" }}>
        <div>
          <label style={label}>Name</label>
          <input autoFocus value={name} placeholder="e.g. Everyday account" onChange={(e) => setName(e.target.value)} style={s.input} />
        </div>
        <div>
          <label style={label}>Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={s.input}>
            {ACCOUNT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
          </select>
        </div>
        {!editing && (
          <>
            <div>
              <label style={label}>{liability ? `Amount owed (${currencyCode()})` : `Balance (${currencyCode()})`}</label>
              <input inputMode="decimal" value={balance} placeholder="0" onChange={(e) => setBalance(e.target.value)} style={s.input} />
            </div>
            <div>
              <label style={label}>As of</label>
              <input type="date" value={date} max={todayISO} onChange={(e) => setDate(e.target.value)} style={s.input} />
            </div>
          </>
        )}
      </div>
      {liability && !editing && (
        <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginBottom: SPACE.sm }}>
          Enter what you owe as a positive number. It's taken off your net worth.
        </div>
      )}
      <button style={{ ...s.saveBtn, opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "not-allowed" }} disabled={!valid}
        onClick={() => onSave({ name: name.trim(), kind, amount, date })}>
        {valid ? "Save" : editing ? "Fill in a name" : "Fill in a name and balance"}
      </button>
      {editing && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: SPACE.md }}>
          <button style={s.linkBtn} onClick={() => onSetClosed(!account.closed)}
            title={account.closed ? undefined : "Records a zero balance today and moves it to closed accounts. Its history is kept."}>
            {account.closed ? "Reopen account" : "Close account"}
          </button>
          <button style={{ ...s.linkBtn, color: theme.danger }} onClick={() => (armDelete ? onDelete() : setArmDelete(true))}>
            {armDelete ? "Click again to delete it and its history" : "Delete account"}
          </button>
        </div>
      )}
    </Modal>
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

// Recovery for a period created before the rollover fix landed, or one whose
// entries were deleted by accident: the template still knows what belongs here.
function MissingFromTemplate({ missing, noun, onAdd }) {
  const { theme, s } = useThemed();
  if (!missing.length) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap",
      background: theme.accentSoft, border: `1px solid ${theme.border}`,
      borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.sm,
    }}>
      <span style={{ ...TYPE.caption, color: theme.text }}>
        {missing.length} {noun}{missing.length !== 1 ? "s" : ""} from your template {missing.length !== 1 ? "are" : "is"} not in this period: {missing.map((x) => x.name).join(", ")}
      </span>
      <button style={{ ...s.linkBtn, padding: 0, marginLeft: "auto" }} onClick={onAdd}>
        Add {missing.length !== 1 ? "them" : "it"} →
      </button>
    </div>
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

function CategoryBudgets({ categories, spent, average, envelopeOf, onSetBudget, onStartFresh }) {
  const { theme, s } = useThemed();
  const [editing, setEditing] = useState(null);
  const [draftCap, setDraftCap] = useState("");
  const [draftRollover, setDraftRollover] = useState(false);

  const startEdit = (c) => {
    setEditing(c.name);
    setDraftCap(c.cap != null ? String(c.cap) : "");
    setDraftRollover(!!c.rollover);
  };
  const commitEdit = () => {
    const n = parseFloat(String(draftCap).replace(",", "."));
    onSetBudget(editing, isFinite(n) && n > 0 ? n : null, draftRollover);
    setEditing(null);
  };
  const cancelEdit = () => setEditing(null);

  const rows = categories
    .filter((c) => c.name !== "Uncategorized")
    .map((c) => {
      const sp = spent.get(c.name) || 0;
      // What this period can spend: the budget, plus or minus whatever rolled
      // in. An envelope already empty on arrival is over budget at once.
      const env = envelopeOf(c, sp);
      const pct = env.available == null ? null
        : env.available > 0 ? (sp / env.available) * 100
        : (sp > 0 || env.available < 0 ? Infinity : 0);
      return { ...c, sp, pct, env };
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
                    {fmt(r.sp)} / {r.env.available != null ? fmt(r.env.available) : "—"}
                  </span>
                )}
                {!isEditing && (
                  <button style={s.editBtn} onClick={() => startEdit(r)}>{r.env.cap != null ? "✎" : "+"}</button>
                )}
                {isEditing && (
                  <>
                    <input type="text" inputMode="decimal" autoFocus
                      value={draftCap}
                      placeholder="Budget"
                      aria-label={`Budget for ${r.name}`}
                      onChange={(e) => setDraftCap(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                      style={{ width: 80, ...s.input, padding: "6px 10px", fontSize: 12 }} />
                    <button style={s.editBtn} onClick={commitEdit}>✓</button>
                    <button style={s.delBtn} onClick={cancelEdit}>✕</button>
                  </>
                )}
              </div>
            </div>
            {isEditing && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: SPACE.sm, margin: "2px 0 8px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, ...TYPE.finePrint, color: theme.textMuted, cursor: "pointer" }}
                  title="Unspent budget carries into next month. Overspending carries too, as a deficit.">
                  <input type="checkbox" checked={draftRollover} onChange={(e) => setDraftRollover(e.target.checked)} />
                  Roll over what's left into next month
                </label>
                {r.rollover && r.env.carry !== 0 && (
                  <button style={{ ...s.linkBtn, ...TYPE.finePrint }} onClick={() => { onStartFresh(r.name); setEditing(null); }}
                    title="Forget the carried balance and count from this month">Start fresh</button>
                )}
              </div>
            )}
            {r.env.available != null && (
              <div style={{ height: 6, background: theme.bg, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, r.pct)}%`, height: "100%", background: barColor, transition: "width .3s" }} />
              </div>
            )}
            {(r.rollover || avg != null) && (
              <div style={{ fontSize: 11, color: theme.textFaint, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                {r.rollover && (
                  <span title={`Budget ${fmt(r.env.cap)} this month, ${r.env.carry >= 0 ? "plus" : "less"} what carried over`}
                    style={{ color: r.env.carry < 0 ? theme.danger : r.env.carry > 0 ? theme.accent : theme.textFaint }}>
                    ↻ {r.env.carry > 0 ? `${fmt(r.env.carry)} carried in`
                      : r.env.carry < 0 ? `${fmt(-r.env.carry)} overspent before`
                      : "Rolls over"}
                  </span>
                )}
                {r.rollover && avg != null && " · "}
                {avg != null && `avg of past months: ${fmt(avg)}`}
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
  // Undo history. Snapshots are cheap: every update is immutable, so each one
  // shares all unchanged structure with its predecessor.
  const dataRef = useRef(data);
  dataRef.current = data;
  const historyRef = useRef({ past: [], future: [], lastPushAt: 0 });
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [historyKey, setHistoryKey] = useState(null);
  const [reportRange, setReportRange] = useState(null);
  const importInputRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem("themeMode") || "light"; } catch { return "light"; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
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
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== "object" || !parsed.months || typeof parsed.months !== "object") {
          alert("Could not read backup file. Make sure it's a valid budget-ctrl JSON export.");
          return;
        }
        if (!confirm("Replace ALL current data with the contents of this backup? This cannot be undone.")) return;
        // Snapshot what is about to be overwritten, so "this cannot be undone"
        // is only true of the click, not of the data.
        if (isTauri) {
          try {
            const current = await window.storage.get(STORAGE_KEY);
            if (current?.value) await writeBackup(current.value, "before-import");
          } catch { /* never block the import on a failed snapshot */ }
        }
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

  // Every user change goes through here and becomes undoable. System writes -
  // first-launch defaults, the period rollover - pass { undoable: false }, so
  // Ctrl+Z can never undo something the user did not do.
  const save = useCallback(async (next, opts = {}) => {
    if (opts.undoable !== false) {
      const h = historyRef.current;
      const now = Date.now();
      // Saves within a second coalesce into one step. Some inputs save on every
      // keystroke; undo should step back over "8000", not over each digit.
      if (now - h.lastPushAt > 1000 || !h.past.length) {
        h.past.push(dataRef.current);
        if (h.past.length > UNDO_LIMIT) h.past.shift();
      }
      h.lastPushAt = now;
      h.future = [];
      setHistorySize({ past: h.past.length, future: 0 });
    }
    setData(next);
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(next)); } catch { /* in-memory state still updated; surfaced on next load */ }
  }, []);

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
          // Persist immediately rather than holding defaults in memory, so the
          // data file exists from first launch instead of first edit.
          await save(hydrate(defaultData()), { undoable: false });
        }
      } catch { /* Tauri API unavailable (browser dev server) */ }
      setLoaded(true);
    })();
    // `save` has no deps of its own, so this still runs exactly once.
  }, [save]);

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

  // Applied during render so every fmt() below this line uses the chosen
  // currency, including the ones inside helpers called from the JSX.
  setMoneyFormat(data.currency, data.locale || navigator.language || "en-US");

  const deleteArm = useMemo(() => ({ armedId: pendingDelete, arm: setPendingDelete }), [pendingDelete]);

  // ensureCurrentMonth used to run only inside hydrate(), i.e. only at launch.
  // Since the app lives in the tray it can sit running across a period boundary,
  // so a new period was never created and the recurring and credit templates
  // never copied in. Worse, both `cur` and patchMonth fall back to emptyMonth(),
  // so the first edit in the new period would persist that empty month and lose
  // the templates for good. Re-running it on every date tick closes that window.
  useEffect(() => {
    if (!loaded) return;
    const rolled = ensureCurrentMonth(data);
    if (rolled !== data) save(rolled, { undoable: false });
  }, [loaded, todayKey, data, save]);

  const openDueSoon = useCallback(() => setTab("duesoon"), []);
  useReminders(data, loaded, setTodayKey, openDueSoon);
  const updater = useUpdater(data.updates?.auto !== false, loaded);

  // "Start with Windows" is a login entry holding the app's path, and that path
  // moves when the installer does (0.5.0 moved from a per-machine .msi to a
  // per-user setup). Rewriting it at each launch keeps it pointing at this copy.
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const a = await import("@tauri-apps/plugin-autostart");
        if (await a.isEnabled()) await a.enable();
      } catch { /* the setting still shows its real state in Settings */ }
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  const restore = useCallback(async (from, to, label) => {
    const h = historyRef.current;
    if (!h[from].length) { setToast(`Nothing to ${label.toLowerCase()}`); return; }
    const target = h[from].pop();
    h[to].push(dataRef.current);
    h.lastPushAt = 0; // the next edit starts a fresh undo step
    setHistorySize({ past: h.past.length, future: h.future.length });
    setData(target);
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(target)); } catch { /* in-memory state still updated */ }
    setToast(label === "Undo" ? "Undone" : "Redone");
  }, []);
  const undo = useCallback(() => restore("past", "future", "Undo"), [restore]);
  const redo = useCallback(() => restore("future", "past", "Redo"), [restore]);

  // Desktop shortcuts. Ctrl/Cmd+Z, Shift+Ctrl+Z or Ctrl+Y, Ctrl+1-9 for tabs;
  // N for a new entry and / for search when not typing. Nothing fires behind an
  // open dialog, and undo leaves text fields alone so their own undo works.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const tag = (el?.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable;
      const dialogOpen = !!modal || settingsOpen || categoriesOpen || statementOpen;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (dialogOpen) return;
      if (mod && key === "z" && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && key === "y" && !typing) { e.preventDefault(); redo(); return; }
      if (mod && /^[0-9]$/.test(e.key)) {
        // Ctrl+0 is the tenth tab, as on a keyboard's number row.
        const target = TABS[e.key === "0" ? 9 : Number(e.key) - 1];
        if (target) { e.preventDefault(); setTab(target.id); if (target.id !== "history") setHistoryKey(null); }
        return;
      }
      if (typing || mod || e.altKey) return;
      if (key === "n" && ADD_LABELS[tab]) { e.preventDefault(); setModal({ type: MODAL_FOR_TAB[tab] || tab }); return; }
      if (key === "/") {
        const search = document.querySelector('main input[placeholder^="Search"]');
        if (search) { e.preventDefault(); search.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, settingsOpen, categoriesOpen, statementOpen, tab, undo, redo]);

  // Derived from todayKey rather than recomputed per render: stable within a
  // day, and guaranteed to refresh when the tick above crosses midnight. Local
  // midnight is also the right value for the day-granularity comparisons in
  // isRecurringDue, which treat period bounds as whole days.
  const today = useMemo(() => new Date(`${todayKey}T00:00:00`), [todayKey]);

  if (!loaded) return <div style={s.shell}><div style={{ color: "#6b7280", textAlign: "center", marginTop: 200, fontSize: 14 }}>Loading...</div></div>;

  const cutoffDay = data.cutoffDay || 1;
  const curKey = currentPeriodKey(cutoffDay);
  const cur = data.months[curKey] || emptyMonth();

  // Every spending and income figure on screen comes from these two. Nothing
  // below re-sums entries, or the cards and charts drift apart again.
  const spending = periodSpending(cur, curKey, today, cutoffDay);
  const income = periodIncome(cur, curKey, today, cutoffDay);
  const totalExpenses = spending.expenses;
  const totalRecurringAll = cur.recurring.reduce((a, e) => a + e.amount, 0);
  const totalRecurringFuture = totalRecurringAll - spending.recurring;
  const totalUnpaidUpcoming = cur.upcoming.filter((u) => !upcomingSettled(u, today)).reduce((a, e) => a + e.amount, 0);
  const isReceived = (c) => creditReceived(c, curKey, today, cutoffDay);
  const totalCredits = income.credits;
  const totalCreditsPending = income.pending;
  const effectiveIncome = income.total;
  const totalActuallySpent = spending.total;
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
  // Only bills due THIS period can be missing from it. Without the cycle check a
  // yearly bill would be reported missing in the eleven periods it is not due.
  const missingRecurring = (data.recurringTemplate || []).filter(
    (tpl) => isOnCycle(tpl, curKey) && !cur.recurring.some((r) => r.templateId === tpl.id));
  const missingCredits = (data.creditTemplate || []).filter(
    (tpl) => isOnCycle(tpl, curKey) && !(cur.credits || []).some((c) => c.templateId === tpl.id));
  const offCycleRecurring = (data.recurringTemplate || []).filter((tpl) => !isOnCycle(tpl, curKey));
  const offCycleCredits = (data.creditTemplate || []).filter((tpl) => !isOnCycle(tpl, curKey));
  const reminderLeadDays = Number.isFinite(data.reminders?.leadDays) ? data.reminders.leadDays : 3;
  // Exactly what a reminder would fire for, so the notification and the screen
  // can never disagree about what is due.
  const dueBills = collectDueBills(data, today, reminderLeadDays, Infinity);
  const totalUpcoming = totalUnpaidUpcoming;

  const catBreakdown = categoryBreakdown(spending.byCategory, data.categories || []);
  const catTotal = spending.total;
  const monthlyData = monthlyTotals(data, today);
  const savings = cumulativeSavings(data, today);
  const spentByCat = spending.byCategory;
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

  // Budget and rollover change together, as one undo step. A budget change
  // applies from this period on; earlier periods keep the budget they had.
  const onSetBudget = (name, newCap, rollover) => {
    save({
      ...data,
      categories: data.categories.map((c) => {
        if (c.name !== name) return c;
        const capped = (c.cap ?? null) === newCap ? c : withCap(c, newCap, curKey);
        return withRollover(capped, rollover, curKey);
      }),
    });
  };
  const todayISO = isoDay(today);
  const installUpdate = () => updater.install(async (version) => {
    const current = await window.storage.get(STORAGE_KEY);
    if (current?.value) await writeBackup(current.value, `before-update-${version}`);
  });
  const accounts = data.accounts || [];
  const saveAccounts = (next) => save({ ...data, accounts: next });
  const onRecordBalance = (id, entry) => saveAccounts(accounts.map((a) => (a.id === id ? recordBalance(a, entry) : a)));
  const onRemoveBalance = (id, date) => saveAccounts(accounts.map((a) => (a.id === id ? removeBalance(a, date) : a)));

  const onStartFresh = (name) => {
    save({ ...data, categories: data.categories.map((c) => (c.name === name ? startFresh(c, curKey) : c)) });
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
            <span style={{ ...TYPE.finePrint, color: theme.outerTextMuted, fontWeight: 600 }}>{data.currency}</span>
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
            <button style={s.dataLink} onClick={() => exportData(data)} title="Full backup, for restoring with Import">EXPORT</button>
            <button style={s.dataLink} onClick={() => exportCsv(data)} title="Every entry as a spreadsheet">EXPORT CSV</button>
            <button style={s.dataLink} onClick={() => setStatementOpen(true)} title="Add transactions from a bank CSV">IMPORT STATEMENT</button>
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
              style={{ ...s.themeToggle, opacity: historySize.past ? 1 : 0.35, cursor: historySize.past ? "pointer" : "default" }}
              disabled={!historySize.past}
              onClick={undo}
              title="Undo (Ctrl+Z)"
            >↶</button>
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
          <UpdateBanner updater={updater} onInstall={installUpdate} />
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
                      <span style={{ ...TYPE.caption, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
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
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Category Budgets</div>
                    <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setCategoriesOpen(true)}>Manage</button>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <CategoryBudgets
                      categories={data.categories}
                      spent={spentByCat}
                      average={(name) => categoryAverage(data, name, curKey, today)}
                      envelopeOf={(c, sp) => envelope(data, c, curKey, today, sp)}
                      onSetBudget={onSetBudget}
                      onStartFresh={onStartFresh}
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
                <div style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
                  <div style={s.cardTitle}>All Expenses</div>
                  <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setStatementOpen(true)}>Import from bank</button>
                </div>
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
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#0066cc", fontSize: 16 }}>This period: {fmt(totalRecurringAll)}</div>
              </div>
              <MissingFromTemplate
                missing={missingRecurring}
                noun="recurring payment"
                onAdd={() => patchCur({ recurring: [...cur.recurring, ...missingRecurring.map((tpl) => ({ ...tpl, id: uid(), templateId: tpl.id }))] })}
              />
              <input
                type="text"
                placeholder="Search recurring..."
                value={recurringView.search}
                onChange={(e) => setRecurringView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredRecurring.length === 0 ? <div style={s.empty}>{recurringView.search ? `No recurring items match "${recurringView.search}".` : offCycleRecurring.length ? "Nothing recurring is due this period." : `No recurring payments set up. Click "+ Add Recurring" to create one.`}</div> : (
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
              <NotDueThisPeriod items={offCycleRecurring} curKey={curKey} cutoffDay={cutoffDay} categories={data.categories}
                onEdit={(tpl) => setModal({ type: "recurring", templateId: tpl.id })}
                onDelete={(tpl) => save({ ...data, recurringTemplate: data.recurringTemplate.filter((x) => x.id !== tpl.id) })} />
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
                <EntryName name={c.name} note={c.note} every={c.every} />
                <div style={{ flex: 1.2 }}><CategoryPill categoryName={c.category || c.source} categories={data.creditCategories || []} fallback={CREDIT_UNCATEGORIZED} /></div>
                {kind === "recurring"
                  ? <div style={{ flex: 1, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>{c.dayOfMonth || "—"}</div>
                  : <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{c.date}</div>}
                <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: isReceived(c) ? "#10b981" : theme.textMuted }}>+{fmt(c.amount)}</div>
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
                  <MissingFromTemplate
                    missing={missingCredits}
                    noun="recurring credit"
                    onAdd={() => patchCur({ credits: [...(cur.credits || []), ...missingCredits.map((tpl) => ({ ...tpl, id: uid(), templateId: tpl.id }))] })}
                  />
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
                  <NotDueThisPeriod items={offCycleCredits} curKey={curKey} cutoffDay={cutoffDay}
                    categories={data.creditCategories || []} fallback={CREDIT_UNCATEGORIZED} positive
                    onEdit={(tpl) => setModal({ type: "creditRecurring", templateId: tpl.id })}
                    onDelete={(tpl) => save({ ...data, creditTemplate: (data.creditTemplate || []).filter((x) => x.id !== tpl.id) })} />
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
                      const inc = periodIncome(m, k, today, cutoffDay);
                      const credits = inc.credits;
                      const spent = periodSpending(m, k, today, cutoffDay).total;
                      const rem = inc.total - spent;
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
            const spent = periodSpending(m, historyKey, today, cutoffDay).total;
            const inc = periodIncome(m, historyKey, today, cutoffDay);
            const credits = inc.credits;
            const effective = inc.total;
            const rem = effective - spent;
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
                  <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
                </div>
                <div style={s.statsRow}>
                  <StatCard label="Income" value={fmt(effective)} accent="#10b981" sub={credits > 0 ? `+${fmt(credits)} credits` : "For this month"} icon="↑" />
                  <StatCard label="Remaining" value={fmt(rem)} accent={rem >= 0 ? "#10b981" : "#ef4444"} sub="After everything paid" icon="↓" />
                  <StatCard label="Total Spent" value={fmt(spent)} accent="#ef4444" sub={`${m.expenses.length} one-off · ${m.recurring.length} recurring`} icon="↻" />
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
                          <EntryName name={c.name} note={c.note} every={c.every} />
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
          {tab === "reports" && (
            <ReportsView data={data} today={today} curKey={curKey} range={reportRange} onRange={setReportRange}
              onOpenPeriod={(key) => {
                if (key === curKey) { setTab("dashboard"); return; }
                if (data.months[key]) { setTab("history"); setHistoryKey(key); }
              }} />
          )}

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
                  <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
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
                  <span style={{ ...TYPE.caption, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
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

          {tab === "accounts" && (
            <AccountsView accounts={accounts} todayISO={todayISO}
              onAdd={() => setModal({ type: "account" })}
              onEdit={(a) => setModal({ type: "account", editId: a.id })}
              onRecord={onRecordBalance} onRemoveBalance={onRemoveBalance} />
          )}
        </div>
        </div>
      </main>

      {/* MODALS */}
      {modal?.type === "account" && (() => {
        const editing = modal.editId ? accounts.find((a) => a.id === modal.editId) : null;
        const replace = (next) => saveAccounts(accounts.map((a) => (a.id === editing.id ? next : a)));
        return (
          <AccountModal account={editing} todayISO={todayISO} onDismiss={() => setModal(null)}
            onSave={(v) => {
              if (editing) replace({ ...editing, name: v.name, kind: v.kind });
              else saveAccounts([...accounts, recordBalance({ id: uid(), name: v.name, kind: v.kind, balances: [] }, { date: v.date, amount: v.amount })]);
              setModal(null);
            }}
            onSetClosed={(close) => { replace(close ? closeAccount(editing, todayISO) : reopenAccount(editing)); setModal(null); }}
            onDelete={() => { saveAccounts(accounts.filter((a) => a.id !== editing.id)); setModal(null); }} />
        );
      })()}
      {modal?.type === "expense" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const editing = modal.editId ? targetMonth.expenses.find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Expense" : "Add Expense"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Groceries", defaultValue: editing?.name },
            { key: "amount", label: `Amount (${currencyCode()})`, type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "date", label: "Date", type: "date", defaultValue: editing?.date || `${targetKey}-01` },
            NOTE_FIELD(editing),
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
                      ? { ...x, name: v.name, amount: +v.amount, date: v.date, category: category.name, note: cleanNote(v.note) }
                      : x),
                  },
                },
              });
            } else {
              const newExp = { id: uid(), name: v.name, amount: +v.amount, date: v.date, category: category.name, note: cleanNote(v.note) };
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
        // A bill not due this period has no instance here, only its template.
        const editingTpl = modal.templateId ? (data.recurringTemplate || []).find((x) => x.id === modal.templateId) : null;
        const tplOf = editing ? (data.recurringTemplate || []).find((x) => x.id === editing.templateId) : null;
        const source = editingTpl || editing;
        const sched = editingTpl || tplOf || editing || {};
        return (
          <FormModal title={source ? "Edit Recurring Payment" : "Add Recurring Payment"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Rent", defaultValue: source?.name },
            { key: "amount", label: `Amount (${currencyCode()})`, type: "number", placeholder: "0", defaultValue: source ? String(source.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: source?.category },
            { key: "dayOfMonth", label: "Day of Month", type: "number", placeholder: "1", defaultValue: source ? String(source.dayOfMonth) : "" },
            // Frequency belongs to the template, so it is offered only where the
            // template is being edited - not on a correction to a past period.
            ...(touchesTemplate ? [
              { key: "repeats", label: "Repeats", type: "select", options: FREQUENCIES.map((f) => f.label), defaultValue: frequencyLabel(sched.every) },
              { key: "anchor", label: "First due in", type: "month", defaultValue: sched.anchor || targetKey },
            ] : []),
            { key: "autoPay", label: "Pays itself", type: "checkbox", defaultValue: source?.autoPay,
              hint: "Direct debit or card on file. Never sends a reminder." },
            NOTE_FIELD(source),
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const { categories, category } = ensureCategory(data.categories, v.category);
            const fields = { name: v.name, amount: +v.amount, dayOfMonth: +v.dayOfMonth || 1, category: category.name,
                             autoPay: !!v.autoPay, note: cleanNote(v.note) };
            const every = touchesTemplate ? everyFromLabel(v.repeats) : (sched.every || 1);
            // Monthly items carry no schedule at all, exactly like items saved
            // before frequencies existed.
            const schedule = every > 1
              ? { every, anchor: v.anchor || sched.anchor || targetKey }
              : { every: undefined, anchor: undefined };
            const dueNow = isOnCycle(schedule, curKey);

            if (editingTpl) {
              const tpl = { ...editingTpl, ...fields, ...schedule };
              const has = cur.recurring.some((r) => r.templateId === tpl.id);
              save({
                ...data, categories,
                recurringTemplate: data.recurringTemplate.map((x) => x.id === tpl.id ? tpl : x),
                // Rescheduled into this period: give it an instance now, since the
                // rollover that would have created one has already happened.
                months: dueNow && !has
                  ? { ...data.months, [curKey]: { ...cur, recurring: [...cur.recurring, { ...tpl, id: uid(), templateId: tpl.id }] } }
                  : data.months,
              });
            } else if (editing) {
              const updatedItem = { ...editing, ...fields, ...(touchesTemplate ? schedule : {}) };
              // Rescheduled out of this period: this instance goes, the template stays.
              const nextRecurring = touchesTemplate && !dueNow
                ? targetMonth.recurring.filter((x) => x.id !== editing.id)
                : targetMonth.recurring.map((x) => x.id === editing.id ? updatedItem : x);
              save({
                ...data, categories,
                months: { ...data.months, [targetKey]: { ...targetMonth, recurring: nextRecurring } },
                recurringTemplate: touchesTemplate
                  ? data.recurringTemplate.map((x) => x.id === editing.templateId ? { ...x, ...fields, ...schedule } : x)
                  : data.recurringTemplate,
              });
            } else {
              const tid = uid();
              const tpl = { id: tid, ...fields, ...(touchesTemplate ? schedule : {}) };
              // A past-period add is a one-off correction with no template; a
              // current-period add appears here only if it is due here.
              const addHere = !touchesTemplate || dueNow;
              save({
                ...data, categories,
                months: addHere
                  ? { ...data.months, [targetKey]: { ...targetMonth, recurring: [...targetMonth.recurring, { ...tpl, id: uid(), templateId: tid }] } }
                  : data.months,
                recurringTemplate: touchesTemplate ? [...data.recurringTemplate, tpl] : data.recurringTemplate,
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
            { key: "amount", label: `Amount (${currencyCode()})`, type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "dueDate", label: "Due Date", type: "date", defaultValue: editing?.dueDate || `${targetKey}-01` },
            { key: "autoPay", label: "Pays itself", type: "checkbox", defaultValue: editing?.autoPay,
              hint: "Direct debit or card on file. Counts as paid on its due date and never sends a reminder." },
            NOTE_FIELD(editing),
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
                      ? { ...x, name: v.name, amount: +v.amount, dueDate: v.dueDate, category: category.name, autoPay: !!v.autoPay, note: cleanNote(v.note) }
                      : x),
                  },
                },
              });
            } else {
              const newItem = { id: uid(), name: v.name, amount: +v.amount, dueDate: v.dueDate, paid: false, autoPay: !!v.autoPay, category: category.name, note: cleanNote(v.note) };
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
        const editingTpl = modal.templateId ? (data.creditTemplate || []).find((x) => x.id === modal.templateId) : null;
        const tplOf = editing ? (data.creditTemplate || []).find((x) => x.id === editing.templateId) : null;
        const source = editingTpl || editing;
        const sched = editingTpl || tplOf || editing || {};
        return (
          <FormModal title={source ? "Edit Recurring Credit" : "Add Recurring Credit"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Allowance", defaultValue: source?.name },
            { key: "amount", label: `Amount (${currencyCode()})`, type: "number", placeholder: "0", defaultValue: source ? String(source.amount) : "" },
            { key: "category", label: "Source", type: "category", categories: data.creditCategories || [], defaultValue: source?.category },
            { key: "dayOfMonth", label: "Day of Month", type: "number", placeholder: "1", defaultValue: source ? String(source.dayOfMonth) : "" },
            // Frequency belongs to the template, so it is offered only where the
            // template is being edited - not on a correction to a past period.
            ...(touchesTemplate ? [
              { key: "repeats", label: "Repeats", type: "select", options: FREQUENCIES.map((f) => f.label), defaultValue: frequencyLabel(sched.every) },
              { key: "anchor", label: "First due in", type: "month", defaultValue: sched.anchor || targetKey },
            ] : []),
            NOTE_FIELD(source),
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const amt = +v.amount;
            if (!v.name || !(amt > 0)) { setModal(null); return; }
            const { categories: creditCategories, category } = ensureCreditCategory(data.creditCategories || [], v.category);
            const fields = { name: v.name, amount: amt, dayOfMonth: +v.dayOfMonth || 1, category: category.name, note: cleanNote(v.note) };
            const every = touchesTemplate ? everyFromLabel(v.repeats) : (sched.every || 1);
            const schedule = every > 1
              ? { every, anchor: v.anchor || sched.anchor || targetKey }
              : { every: undefined, anchor: undefined };
            const dueNow = isOnCycle(schedule, curKey);
            const curCredits = cur.credits || [];
            const tmpl = data.creditTemplate || [];

            if (editingTpl) {
              const tpl = { ...editingTpl, ...fields, ...schedule };
              const has = curCredits.some((c) => c.templateId === tpl.id);
              save({
                ...data, creditCategories,
                creditTemplate: tmpl.map((x) => x.id === tpl.id ? tpl : x),
                months: dueNow && !has
                  ? { ...data.months, [curKey]: { ...cur, credits: [...curCredits, { ...tpl, id: uid(), templateId: tpl.id }] } }
                  : data.months,
              });
            } else if (editing) {
              const updated = { ...editing, ...fields, ...(touchesTemplate ? schedule : {}) };
              const credits = targetMonth.credits || [];
              const nextCredits = touchesTemplate && !dueNow
                ? credits.filter((x) => x.id !== editing.id)
                : credits.map((x) => x.id === editing.id ? updated : x);
              save({
                ...data, creditCategories,
                months: { ...data.months, [targetKey]: { ...targetMonth, credits: nextCredits } },
                creditTemplate: touchesTemplate
                  ? tmpl.map((x) => x.id === editing.templateId ? { ...x, ...fields, ...schedule } : x)
                  : tmpl,
              });
            } else {
              const tid = uid();
              const tpl = { id: tid, ...fields, ...(touchesTemplate ? schedule : {}) };
              const addHere = !touchesTemplate || dueNow;
              save({
                ...data, creditCategories,
                months: addHere
                  ? { ...data.months, [targetKey]: { ...targetMonth, credits: [...(targetMonth.credits || []), { ...tpl, id: uid(), templateId: tid }] } }
                  : data.months,
                creditTemplate: touchesTemplate ? [...tmpl, tpl] : tmpl,
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
            { key: "amount", label: `Amount (${currencyCode()})`, type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Source", type: "category", categories: data.creditCategories || [], defaultValue: editing?.category || editing?.source },
            { key: "date", label: "Date", type: "date", defaultValue: editing?.date || `${targetKey}-01` },
            NOTE_FIELD(editing),
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const amt = +v.amount;
            if (!v.name || !(amt > 0)) { setModal(null); return; }
            const { categories: creditCategories, category } = ensureCreditCategory(data.creditCategories || [], v.category);
            const nextCredits = editing
              ? (targetMonth.credits || []).map((x) => x.id === editing.id
                  ? { ...x, name: v.name, amount: amt, date: v.date, category: category.name, note: cleanNote(v.note) }
                  : x)
              : [...(targetMonth.credits || []), { id: uid(), name: v.name, amount: amt, date: v.date, category: category.name, note: cleanNote(v.note) }];
            save({
              ...data,
              creditCategories,
              months: { ...data.months, [targetKey]: { ...targetMonth, credits: nextCredits } },
            });
            setModal(null);
          }} />
        );
      })()}

      <Toast message={toast} />

      {statementOpen && (
        <StatementImport data={data} onClose={() => setStatementOpen(false)}
          onImport={async (next, counts) => {
            // A statement can add hundreds of rows at once. Snapshot first, so a
            // wrong column guess is one restore away rather than an afternoon.
            if (isTauri) {
              try {
                const current = await window.storage.get(STORAGE_KEY);
                if (current?.value) await writeBackup(current.value, "before-statement-import");
              } catch { /* never block the import on a failed snapshot */ }
            }
            await save(next);
            setStatementOpen(false);
            const parts = [];
            if (counts.expenses) parts.push(`${counts.expenses} expense${counts.expenses !== 1 ? "s" : ""}`);
            if (counts.credits) parts.push(`${counts.credits} credit${counts.credits !== 1 ? "s" : ""}`);
            if (counts.markedPaid) parts.push(`${counts.markedPaid} payment${counts.markedPaid !== 1 ? "s" : ""} marked paid`);
            alert(`Imported ${parts.join(", ") || "nothing"}.` +
              (isTauri ? "\n\nA backup was taken first — restore it from Settings → Data if anything looks wrong." : ""));
          }} />
      )}

      {categoriesOpen && (
        <CategoryManager data={data} onClose={() => setCategoriesOpen(false)} onChange={(next) => save(next)} />
      )}

      {settingsOpen && (
        <SettingsModal
          data={data}
          onClose={() => setSettingsOpen(false)}
          onChangeReminders={(reminders) => save({ ...data, reminders })}
          updater={updater}
          onChangeUpdates={(updates) => save({ ...data, updates })}
          onInstallUpdate={installUpdate}
          onChangeCurrency={(currency) => save({ ...data, currency })}
          onChangeLocale={(locale) => save({ ...data, locale })}
          onManageCategories={() => { setSettingsOpen(false); setCategoriesOpen(true); }}
          onRestore={async (name) => {
            if (!confirm(`Replace all current data with the backup "${name}"?

What you have now is backed up first.`)) return;
            try {
              const text = await readBackup(name);
              const parsed = JSON.parse(text);
              if (!parsed || typeof parsed !== "object" || !parsed.months) {
                alert("That backup could not be read.");
                return;
              }
              // Snapshot the current state before replacing it, so restoring to
              // the wrong point is itself recoverable.
              try {
                const current = await window.storage.get(STORAGE_KEY);
                if (current?.value) await writeBackup(current.value, "before-restore");
              } catch { /* never block the restore */ }
              await save(hydrate(migrate(parsed)));
              setSettingsOpen(false);
            } catch {
              alert("That backup could not be read.");
            }
          }}
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
    overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.32)", backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: SPACE.lg, boxSizing: "border-box" },
    modal: { background: theme.surface, borderRadius: RADIUS.lg, padding: SPACE.xl, width: "100%", maxWidth: 460, maxHeight: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box", border: hairline, boxShadow: ELEVATION },
    modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SPACE.xs, flex: "none" },
    // Bleeds into the dialog's side padding so the scrollbar sits at its edge
    // rather than over the content.
    modalBody: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", margin: `0 -${SPACE.xl}px`, padding: `0 ${SPACE.xl}px` },
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