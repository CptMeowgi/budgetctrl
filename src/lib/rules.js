// Import rules: "when a bank description contains BIEDRONKA, it is Food, and
// call it Biedronka". Applied to every new row of a statement import, so a
// monthly import needs ticking through rather than categorising.
//
// A rule: { id, match, exclude?, amount?, category?, rename? }.
//   match    the bank's description contains this;
//   exclude  ...and doesn't contain this;
//   amount   { op: "under" | "over" | "equal", value }, on the amount
//            whichever way the money went.
// Text is compared without case or accents. Rules are checked in order, and
// the first that fits wins: "ORLEN under 50 -> Snacks" above "ORLEN -> Fuel".

import { parseAmount } from "./amounts.js";
import { fold } from "./search.js";

const clean = (s) => fold(s).replace(/\*/g, "").replace(/\s+/g, " ").trim();

// The rule's figure, read as any amount is ("1.234,56", "50 zł", -50), and
// whichever way the money went. An empty figure is no condition: null. One
// that isn't a number is NaN, and the rule doesn't apply until it's fixed.
const figure = (v) => {
  if (v == null || String(v).trim() === "") return null;
  const n = typeof v === "number" ? v : parseAmount(v);
  return n == null || !Number.isFinite(n) ? NaN : Math.abs(n);
};
const hasAmount = (r) => figure(r.amount?.value) != null;
const amountFits = (cond, amount) => {
  const value = figure(cond?.value);
  if (value == null) return true;
  if (Number.isNaN(value) || amount == null || !Number.isFinite(amount)) return false;
  const a = Math.abs(amount);
  return cond.op === "under" ? a < value : cond.op === "over" ? a > value : Math.abs(a - value) < 0.005;
};

// A figure typed that isn't a number, for the rules list to point out.
export function amountProblem(rule) {
  return Number.isNaN(figure(rule?.amount?.value));
}

export function ruleFor(name, rules, amount) {
  const hay = fold(name);
  for (const r of rules || []) {
    const m = clean(r.match);
    // A rule must look for something: text, or at least an amount.
    if (!m && !hasAmount(r)) continue;
    if (m && !hay.includes(m)) continue;
    const not = clean(r.exclude);
    if (not && hay.includes(not)) continue;
    if (!amountFits(r.amount, amount)) continue;
    return r;
  }
  return null;
}

// Words in bank descriptions that say how something was paid, not who to.
// Compared after folding, so they are written without accents.
const GENERIC = new Set([
  "zakup", "przy", "uzyciu", "platnosc", "przelew", "karta", "karty", "blik", "sklep", "transakcja", "oplata",
  "dnia", "tytul", "tytulem", "odbiorca", "nadawca", "rachunek", "konto", "pln", "eur", "usd",
  "pos", "card", "payment", "purchase", "transfer", "debit", "visa", "mastercard", "www", "com", "the", "sp", "zoo",
]);

// What a new rule should look for, from one description: its first word that
// names someone: "ZAKUP PRZY UZYCIU KARTY BIEDRONKA 1234" -> "biedronka". The
// first word of three letters or more that isn't banking filler; the person
// can widen or narrow it afterwards.
export function suggestMatch(name) {
  const words = fold(name).replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const pick = words.find((w) => w.length >= 3 && !GENERIC.has(w));
  return pick || words[0] || "";
}

// Apply the best rule to an import row that is about to become an expense or
// a credit. A rule's category only applies if it is one of that kind's
// categories - a spending rule must not file a refund under Food. The bank's
// own wording is kept in the note when the row is renamed, so it stays
// searchable.
export function applyRule(row, rules, { spendCategories = [], creditCategories = [] } = {}) {
  if (row.action !== "expense" && row.action !== "credit") return row;
  const rule = ruleFor(row.name, rules, row.amount);
  if (!rule) return row;
  const allowed = row.action === "expense" ? spendCategories : creditCategories;
  const out = { ...row, rule: rule.id };
  if (rule.category && allowed.includes(rule.category)) out.category = rule.category;
  if (rule.rename && rule.rename.trim()) {
    out.name = rule.rename.trim();
    if (!row.note) out.note = row.name;
  }
  return out;
}

// Add a rule, or update the plain one that already looks for the same text.
// A rule with conditions is the reader's own and is never overwritten. A new
// rule goes above the first broader one it would otherwise lose to ("orlen
// stop" above "orlen"), so the most specific still wins; otherwise last.
export function upsertRule(rules, rule, newId) {
  const key = clean(rule.match);
  const list = rules || [];
  if (!key) return list;
  const plain = (r) => !clean(r.exclude) && !hasAmount(r);
  const existing = list.find((r) => clean(r.match) === key && plain(r));
  if (existing) return list.map((r) => (r === existing ? { ...r, ...rule, id: r.id } : r));
  // Broader: looks for part of this text, or for no text at all, only an amount.
  const broader = list.findIndex((r) => { const m = clean(r.match); return m ? m !== key && key.includes(m) : hasAmount(r); });
  const added = { id: newId(), ...rule };
  return broader < 0 ? [...list, added] : [...list.slice(0, broader), added, ...list.slice(broader)];
}

// Move a rule one place up (-1) or down (+1).
export function moveRule(rules, id, delta) {
  const i = rules.findIndex((r) => r.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= rules.length) return rules;
  const out = [...rules];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// Rules saved before 0.7 were picked by the longest matching text. Until
// the reader first changes them, they are read in that order, so with
// "first that fits wins" each files as before; saved in order from then on
// (with importRulesOrdered), the order is theirs.
export function orderedRules(data) {
  const list = Array.isArray(data?.importRules) ? data.importRules : [];
  if (data?.importRulesOrdered) return list;
  return list
    .map((r, i) => ({ r, i, n: clean(r.match).length }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.r);
}
