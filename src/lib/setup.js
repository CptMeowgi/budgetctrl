// The welcome screens a brand-new budget starts with: currency, when the
// month starts, this month's income, and some categories to begin with.

import { periodKeyFor } from "./periods.js";

// Offered on the last screen; the first eight start ticked.
export const STARTER_CATEGORIES = [
  { name: "Groceries", icon: "🛒", color: "#10b981", on: true },
  { name: "Home", icon: "🏠", color: "#8b5cf6", on: true },
  { name: "Bills", icon: "📄", color: "#0066cc", on: true },
  { name: "Transport", icon: "🚗", color: "#0ea5e9", on: true },
  { name: "Eating out", icon: "🍔", color: "#f97316", on: true },
  { name: "Health", icon: "💊", color: "#ef4444", on: true },
  { name: "Shopping", icon: "🛍", color: "#ec4899", on: true },
  { name: "Fun", icon: "🎮", color: "#f59e0b", on: true },
  { name: "Subscriptions", icon: "📱", color: "#14b8a6", on: false },
  { name: "Kids", icon: "👶", color: "#a855f7", on: false },
  { name: "Pets", icon: "🐾", color: "#84cc16", on: false },
  { name: "Gifts", icon: "🎁", color: "#e11d48", on: false },
  { name: "Travel", icon: "🧳", color: "#06b6d4", on: false },
  { name: "Education", icon: "🎓", color: "#64748b", on: false },
];

// The money-in sources every budget starts with. "Other" is also the fallback
// for a credit with no source, so it is never renamed or removed.
export const DEFAULT_CREDIT_CATEGORIES = [
  { name: "Refund", color: "#10b981", icon: "↩" },
  { name: "Gift",   color: "#ec4899", icon: "🎁" },
  { name: "Bonus",  color: "#f59e0b", icon: "⭐" },
  { name: "Salary", color: "#0066cc", icon: "💼" },
  { name: "Other",  color: "#9ca3af", icon: "·" },
];

// Apply the answers. Only ever for a brand-new budget: it replaces the empty
// months, because the current period depends on the payday just chosen - with
// a payday of the 25th, 11 October belongs to the period that began on 25
// September.
export function applySetup(data, answers, today) {
  const { currency, locale, cutoffDay, income, setAside, categories } = answers || {};
  const cd = Math.max(1, Math.min(28, Math.floor(Number(cutoffDay)) || 1));
  const cur = periodKeyFor(today, cd);
  const fallback = (data.categories || []).find((c) => c.name === "Uncategorized") || { name: "Uncategorized", color: "#9ca3af", icon: "·" };
  return {
    ...data,
    currency: currency || data.currency,
    locale: locale ?? data.locale,
    cutoffDay: cd,
    months: { [cur]: { income: Math.max(0, Number(income) || 0), expenses: [], recurring: [], upcoming: [], credits: [] } },
    categories: [fallback, ...(categories || []).map(({ name, icon, color }) => ({ name, icon, color }))],
    savingsGoal: { monthly: Math.max(0, Math.round(Number(setAside) || 0)) },
    setupDone: true,
  };
}
