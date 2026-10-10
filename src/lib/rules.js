// Import rules: "when a bank description contains BIEDRONKA, it is Food, and
// call it Biedronka". Applied to every new row of a statement import, so a
// monthly import needs ticking through rather than categorising.
//
// A rule: { id, match, category?, rename? }. `match` is compared without case
// or accents against the bank's description. When several rules match, the
// longest match wins - "orlen paliwo" beats "orlen".

import { fold } from "./search.js";

const clean = (s) => fold(s).replace(/\*/g, "").replace(/\s+/g, " ").trim();

export function ruleFor(name, rules) {
  const hay = fold(name);
  let best = null;
  for (const r of rules || []) {
    const m = clean(r.match);
    if (!m || !hay.includes(m)) continue;
    if (!best || m.length > clean(best.match).length) best = r;
  }
  return best;
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
  const rule = ruleFor(row.name, rules);
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

// Add a rule, or update the one that already looks for the same text.
export function upsertRule(rules, rule, newId) {
  const key = clean(rule.match);
  if (!key) return rules || [];
  const list = rules || [];
  const existing = list.find((r) => clean(r.match) === key);
  if (existing) return list.map((r) => (r === existing ? { ...r, ...rule, id: r.id } : r));
  return [...list, { id: newId(), ...rule }];
}
