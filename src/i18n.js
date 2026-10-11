// Translation. Text is written in English in the code and looked up in the
// dictionary for the active language; anything missing falls back to the
// English, so a gap shows English rather than a blank or a key.
//
//   t("Search everything")
//   t("Lowest point {amount} on {date}", { amount: fmt(x), date })
//   tn(n, "{n} goal", "{n} goals")      - plurals, in each language's forms
//
// A placeholder may also be given a React element (a <strong>, a button);
// t() then returns an array of strings and elements to render.
//
// The language is held at module scope and set by App on every render, the
// same way the money format is: t() is called from plain functions as well as
// components.

import de from "./locales/de.js";
import es from "./locales/es.js";
import pl from "./locales/pl.js";
import zh from "./locales/zh.js";

const DICTS = { de, es, pl, zh };
let lang = "en";

export const LANGUAGES = [
  { value: "", label: "System default" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "pl", label: "Polski" },
  { value: "zh", label: "中文（简体）" },
];

// The plural forms each dictionary writes, in order, by Intl.PluralRules'
// names for them: a plural is stored as "1 Ziel|{n} Ziele", "1 cel|{n} cele|
// {n} celów", or Chinese's single form. A count in a form a dictionary
// doesn't write - Spanish "many" for a million, a Polish fraction - takes
// the last one.
export const PLURAL_FORMS = { de: ["one", "other"], es: ["one", "other"], pl: ["one", "few", "many"], zh: ["other"] };

// Dates and month names. English is British: day before month.
const DATE_LOCALES = { en: "en-GB", de: "de-DE", es: "es-ES", pl: "pl-PL", zh: "zh-CN" };

export function systemLanguage() {
  const nav = ((typeof navigator !== "undefined" && navigator.language) || "").toLowerCase().split("-")[0];
  return DICTS[nav] ? nav : "en";
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
  return DATE_LOCALES[lang] || "en-GB";
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

// Plurals, looked up under "one|other" and written in the forms PLURAL_FORMS
// lists for the language: Polish has one (1), few (2-4, 22-24 ...) and many
// (5-21, 25 ...); German and Spanish one and other; Chinese a single form.
export function tn(n, one, other, vars) {
  const v = { n, ...vars };
  const dict = DICTS[lang];
  const forms = dict && dict[`${one}|${other}`];
  if (forms) {
    const list = forms.split("|");
    const i = PLURAL_FORMS[lang].indexOf(new Intl.PluralRules(lang).select(n));
    return interpolate(list[i === -1 || i >= list.length ? list.length - 1 : i], v);
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
