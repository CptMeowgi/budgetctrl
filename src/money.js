

// Currency was hardcoded to PLN, which made the app unusable outside Poland.
// It is held at module scope rather than passed down because fmt() is called
// from ~56 places, several of them plain functions outside the React tree;
// threading a parameter through all of them would add an argument to half the
// file to express a single global preference. App sets it on every render.
let activeCurrency = "PLN";
let activeLocale = (typeof navigator !== "undefined" && navigator.language) || "en-US";

export function setMoneyFormat(currency, locale) {
  if (currency) activeCurrency = currency;
  if (locale) activeLocale = locale;
}

export function currencyCode() {
  return activeCurrency;
}

export function fmt(n) {
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
export function fmtWhole(n) {
  try {
    return new Intl.NumberFormat(activeLocale, { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n || 0));
  }
}

// A number as someone would type it back into a field: their decimal mark, no
// grouping, no currency. Prefilled inputs read "5800,5", not "5800.5".
export function fmtPlain(n) {
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
export const LOCALE_OPTIONS = [
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

export function detectCurrency() {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return REGION_CURRENCY[region] || "USD";
  } catch {
    return "USD";
  }
}

export function currencyOptions() {
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
