// Small pieces of wording shared across screens.
import { fmtDate, getLanguage, t, tk, tn } from "./i18n.js";
import { DEFAULT_CREDIT_CATEGORIES, STARTER_CATEGORIES } from "./lib/setup.js";
import { parseBackupName } from "./lib/backups.js";

// "just now", "5 minutes ago", "3 hours ago", "2 days ago".
export function ago(then, now) {
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return t("just now");
  if (mins < 60) return tn(mins, "{n} minute ago", "{n} minutes ago");
  const hours = Math.round(mins / 60);
  if (hours < 24) return tn(hours, "{n} hour ago", "{n} hours ago");
  return tn(Math.round(hours / 24), "{n} day ago", "{n} days ago");
}

// The categories Budget Ctrl creates - the fallbacks, the starter set on the
// welcome screens, the default money-in sources - are stored under their
// English names and shown in the reader's language, so changing language
// renames them too. A category someone named themselves stays as typed.
const BUILT_IN_CATEGORIES = new Set([tk("Uncategorized"), tk("Other"), tk("Base income"),
  ...STARTER_CATEGORIES.map((c) => c.name), ...DEFAULT_CREDIT_CATEGORIES.map((c) => c.name)]);
export function catName(name) {
  return BUILT_IN_CATEGORIES.has(name) ? t(name) : name;
}

// What someone typed or picked, as the name its category is stored under:
// "zakupy spożywcze" in Polish is the built-in "Groceries".
export function storedCatName(typed, categories) {
  const v = (typed || "").trim().toLowerCase();
  if (!v) return typed;
  const hit = (categories || []).find((c) => catName(c.name).toLowerCase() === v);
  return hit ? hit.name : typed;
}

// A date in a table: "11 Oct" in the reader's language, with the year only
// when it isn't this year's.
export function shortDate(iso) {
  if (!iso) return "";
  const sameYear = iso.slice(0, 4) === String(new Date().getFullYear());
  return fmtDate(iso, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

// A backup's file name as a person reads it: "11 Oct 2026, 14:32 · before a
// statement import".
export function backupLabel(name) {
  const b = parseBackupName(name);
  if (!b) return name;
  const when = fmtDate(b.date, { day: "numeric", month: "short", year: "numeric" }) + (b.time ? `, ${b.time}` : "");
  const update = /^before-update-(.+)$/.exec(b.tag);
  const why = b.tag === "daily" ? t("start of the day")
    : b.tag === "before-reset" ? t("before starting again")
    : b.tag === "before-import" ? t("before loading a backup file")
    : b.tag === "before-statement-import" ? t("before a statement import")
    : b.tag === "before-restore" ? t("before a restore")
    : b.tag === "before-pay-schedule" ? t("before changing pay schedule")
    : update ? t("before updating to {version}", { version: update[1] })
    : b.tag;
  return `${when} · ${why}`;
}

// When a bill is due, relative to today.
export function due(inDays) {
  if (inDays < 0) return tn(-inDays, "{n} day overdue", "{n} days overdue");
  if (inDays === 0) return t("due today");
  if (inDays === 1) return t("due tomorrow");
  return tn(inDays, "due in {n} day", "due in {n} days");
}

// 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st - or "25." in Polish and
// German, "25" in Spanish ("el día 25") and "25日" in Chinese.
export function ordinal(n) {
  const lang = getLanguage();
  if (lang === "pl" || lang === "de") return `${n}.`;
  if (lang === "es") return String(n);
  if (lang === "zh") return `${n}日`;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th")}`;
}
