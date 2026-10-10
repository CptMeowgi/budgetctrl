// Small pieces of wording shared across screens.
import { getLanguage, t, tk, tn } from "./i18n.js";

// "just now", "5 minutes ago", "3 hours ago", "2 days ago".
export function ago(then, now) {
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return t("just now");
  if (mins < 60) return tn(mins, "{n} minute ago", "{n} minutes ago");
  const hours = Math.round(mins / 60);
  if (hours < 24) return tn(hours, "{n} hour ago", "{n} hours ago");
  return tn(Math.round(hours / 24), "{n} day ago", "{n} days ago");
}

// The built-in categories are stored under their English names. Show those in
// the reader's language; a category someone named themselves stays as typed.
const BUILT_IN_CATEGORIES = new Set([tk("Uncategorized"), tk("Other"), tk("Base income")]);
export function catName(name) {
  return BUILT_IN_CATEGORIES.has(name) ? t(name) : name;
}

// When a bill is due, relative to today.
export function due(inDays) {
  if (inDays < 0) return tn(-inDays, "{n} day overdue", "{n} days overdue");
  if (inDays === 0) return t("due today");
  if (inDays === 1) return t("due tomorrow");
  return tn(inDays, "due in {n} day", "due in {n} days");
}

// 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st - or "25." in Polish.
export function ordinal(n) {
  if (getLanguage() === "pl") return `${n}.`;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th")}`;
}
