// Translation. Text is written in English in the code and looked up in the
// dictionary for the active language; anything missing falls back to the
// English, so a gap shows English rather than a blank or a key.
//
//   t("Search everything")
//   t("Lowest point {amount} on {date}", { amount: fmt(x), date })
//   tn(n, "{n} goal", "{n} goals")      - plurals, with Polish's three forms
//
// A placeholder may also be given a React element (a <strong>, a button);
// t() then returns an array of strings and elements to render.
//
// The language is held at module scope and set by App on every render, the
// same way the money format is: t() is called from plain functions as well as
// components.

import pl from "./locales/pl.js";

const DICTS = { pl };
let lang = "en";

export const LANGUAGES = [
  { value: "", label: "System default" },
  { value: "en", label: "English" },
  { value: "pl", label: "Polski" },
];

export function systemLanguage() {
  const nav = (typeof navigator !== "undefined" && navigator.language) || "";
  return nav.toLowerCase().startsWith("pl") ? "pl" : "en";
}

export function setLanguage(choice) {
  const l = choice || systemLanguage();
  lang = DICTS[l] || l === "en" ? l : "en";
}

export function getLanguage() {
  return lang;
}

// Locale for dates and month names in the active language.
export function dateLocale() {
  return lang === "pl" ? "pl-PL" : "en-GB";
}

export function interpolate(str, vars) {
  if (!vars) return str;
  const parts = str.split(/(\{[a-zA-Z0-9_]+\})/);
  const out = parts.map((p) => {
    const m = /^\{([a-zA-Z0-9_]+)\}$/.exec(p);
    if (!m || !(m[1] in vars)) return p;
    return vars[m[1]];
  });
  // All text: hand back a string. Any element: the pieces, for React to render.
  return out.every((p) => typeof p === "string" || typeof p === "number") ? out.join("") : out.filter((p) => p !== "");
}

// Marks a string for translation where it is defined, for lists of labels
// translated later with t(label). It returns the string unchanged; the
// dictionary test reads these to check every one is translated.
export const tk = (s) => s;

export function t(key, vars) {
  const dict = DICTS[lang];
  return interpolate((dict && dict[key]) || key, vars);
}

// Plurals. English has one and other; Polish has one (1), few (2-4, 22-24 ...)
// and many (5-21, 25 ...), stored as "one|few|many" under "one|other".
export function tn(n, one, other, vars) {
  const v = { n, ...vars };
  const dict = DICTS[lang];
  const forms = dict && dict[`${one}|${other}`];
  if (forms) {
    const [o, f, m] = forms.split("|");
    const cat = new Intl.PluralRules(lang).select(n);
    return interpolate(cat === "one" ? o : cat === "few" ? (f ?? m) : (m ?? f ?? o), v);
  }
  return interpolate(n === 1 ? one : other, v);
}

// Format a date in the active language. English uses British day-month order,
// with "Sep" rather than the newer "Sept".
export function fmtDate(value, options) {
  const d = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00`) : value;
  if (!d || isNaN(d)) return "";
  const s = d.toLocaleDateString(dateLocale(), options);
  return lang === "en" ? s.replace(/\bSept\b/, "Sep") : s;
}
