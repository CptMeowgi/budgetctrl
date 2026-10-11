import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { t, tn, setLanguage, interpolate, fmtDate, LANGUAGES, PLURAL_FORMS, systemLanguage } from "./i18n.js";
import { ago, catName, due, ordinal } from "./text.js";
import de from "./locales/de.js";
import es from "./locales/es.js";
import pl from "./locales/pl.js";
import zh from "./locales/zh.js";
import { ACCOUNT_KINDS } from "./lib/accounts.js";
import { FREQUENCIES } from "./lib/schedule.js";
import { STARTER_CATEGORIES } from "./lib/setup.js";
import { describeUpdateError } from "./lib/updates.js";
import { DEFAULT_CREDIT_CATEGORIES } from "./model.js";

afterEach(() => setLanguage("en"));

describe("t", () => {
  it("is the English text in English", () => {
    setLanguage("en");
    expect(t("Search everything")).toBe("Search everything");
  });

  it("is the Polish in Polish, and falls back to English for a gap", () => {
    setLanguage("pl");
    expect(t("Search everything")).toBe(pl["Search everything"]);
    expect(t("A string nobody translated")).toBe("A string nobody translated");
  });

  it("fills in placeholders", () => {
    expect(t("{a} of {b}", { a: "1", b: 2 })).toBe("1 of 2");
  });
});

describe("interpolate", () => {
  it("returns pieces when a placeholder is an element", () => {
    const el = { type: "strong" };
    expect(interpolate("Lowest {x} today", { x: el })).toEqual(["Lowest ", el, " today"]);
  });

  it("leaves unknown placeholders as they are", () => {
    expect(interpolate("Hi {name}", {})).toBe("Hi {name}");
  });
});

describe("tn", () => {
  it("picks English one or other", () => {
    expect(tn(1, "{n} goal", "{n} goals")).toBe("1 goal");
    expect(tn(3, "{n} goal", "{n} goals")).toBe("3 goals");
  });

  it("picks the right one of the three Polish forms", () => {
    setLanguage("pl");
    const g = (n) => tn(n, "{n} goal", "{n} goals");
    expect([g(1), g(2), g(4), g(5), g(12), g(22), g(25)]).toEqual([
      "1 cel", "2 cele", "4 cele", "5 celów", "12 celów", "22 cele", "25 celów",
    ]);
  });

  it("picks one or other in German and Spanish, and Chinese's single form", () => {
    const g = (n) => tn(n, "{n} goal", "{n} goals");
    setLanguage("de");
    expect([g(1), g(2), g(5)]).toEqual(["1 Ziel", "2 Ziele", "5 Ziele"]);
    setLanguage("es");
    // A million is Spanish "many", a form the dictionary doesn't write: it takes the last.
    expect([g(1), g(2), g(1000000)]).toEqual(["1 objetivo", "2 objetivos", "1000000 objetivos"]);
    setLanguage("zh");
    expect([g(1), g(5)]).toEqual(["1 个目标", "5 个目标"]);
  });
});

describe("systemLanguage", () => {
  it("follows the system language where there is a dictionary, else English", () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const as = (language) => Object.defineProperty(globalThis, "navigator", { value: { language }, configurable: true });
    try {
      expect(["de-AT", "es-MX", "pl-PL", "zh-CN", "fr-FR", "en-US"].map((l) => { as(l); return systemLanguage(); }))
        .toEqual(["de", "es", "pl", "zh", "en", "en"]);
    } finally {
      if (real) Object.defineProperty(globalThis, "navigator", real); else delete globalThis.navigator;
    }
  });
});

describe("fmtDate", () => {
  it("writes dates in the active language", () => {
    expect(fmtDate("2026-09-12", { day: "numeric", month: "short" })).toBe("12 Sep");
    setLanguage("pl");
    expect(fmtDate("2026-09-12", { day: "numeric", month: "long" })).toBe("12 września");
    setLanguage("de");
    expect(fmtDate("2026-09-12", { day: "numeric", month: "long" })).toBe("12. September");
    setLanguage("es");
    expect(fmtDate("2026-09-12", { day: "numeric", month: "long" })).toBe("12 de septiembre");
    setLanguage("zh");
    expect(fmtDate("2026-09-12", { day: "numeric", month: "long" })).toBe("9月12日");
  });
});

describe("due and ordinal", () => {
  it("say when a bill is due", () => {
    expect([-3, -1, 0, 1, 5].map(due)).toEqual(["3 days overdue", "1 day overdue", "due today", "due tomorrow", "due in 5 days"]);
    setLanguage("pl");
    expect([-2, 0, 1, 5].map(due)).toEqual([pl["{n} day overdue|{n} days overdue"].split("|")[1].replace("{n}", "2"),
      pl["due today"], pl["due tomorrow"], pl["due in {n} day|due in {n} days"].split("|")[2].replace("{n}", "5")]);
  });

  it("say how long ago", () => {
    const NOW = Date.UTC(2026, 9, 11, 12);
    const HOUR = 3600 * 1000;
    expect([NOW - 20 * 1000, NOW - 60 * 1000, NOW - 5 * HOUR, NOW - 49 * HOUR].map((x) => ago(x, NOW)))
      .toEqual(["just now", "1 minute ago", "5 hours ago", "2 days ago"]);
    setLanguage("pl");
    expect(ago(NOW - 5 * HOUR, NOW)).toBe(pl["{n} hour ago|{n} hours ago"].split("|")[2].replace("{n}", "5"));
  });

  it("show built-in category names in the reader's language", () => {
    setLanguage("pl");
    expect(catName("Uncategorized")).toBe(pl["Uncategorized"]);
    expect(catName("Groceries")).toBe("Groceries");
  });

  it("number days the local way", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
    setLanguage("pl");
    expect(ordinal(25)).toBe("25.");
    setLanguage("de");
    expect(ordinal(25)).toBe("25.");
    setLanguage("es");
    expect(ordinal(25)).toBe("25");
    setLanguage("zh");
    expect(ordinal(25)).toBe("25日");
  });
});

// Every string the code asks to translate must be in every dictionary, so a
// release can never go out half in English.
const DICTS = { de, es, pl, zh };

describe("the dictionaries", () => {
  it("are the languages Settings offers", () => {
    expect(Object.keys(DICTS).sort()).toEqual(LANGUAGES.map((l) => l.value).filter((v) => v && v !== "en").sort());
    expect(Object.keys(PLURAL_FORMS).sort()).toEqual(Object.keys(DICTS).sort());
  });
});

const SRC = path.dirname(fileURLToPath(import.meta.url));
const files = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== "locales") walk(p); }
    else if (/\.(js|jsx)$/.test(f.name) && !/\.test\.js$/.test(f.name) && f.name !== "i18n.js") files.push(p);
  }
};
walk(SRC);

// Read a string literal starting at `i` (either quote style); return its
// value and where it ends.
const readString = (src, i) => {
  const q = src[i];
  if (q !== '"' && q !== "'") return null;
  let out = "";
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") {
      const n = src[j + 1];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
      j++;
    } else if (c === q) {
      return { value: out, end: j + 1 };
    } else {
      out += c;
    }
  }
  return null;
};
const skipSpace = (src, i) => { while (/\s/.test(src[i] || "")) i++; return i; };

const keys = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  // why() and fail() carry the importer's reasons and the category errors,
  // which are translated where they are shown.
  for (const m of src.matchAll(/\b(t|tk|why|fail)\(/g)) {
    const s = readString(src, skipSpace(src, m.index + m[0].length));
    if (s) keys.set(s.value, path.basename(f));
  }
  for (const m of src.matchAll(/\btn\(/g)) {
    // tn(count, "one", "other", ...): skip the count to the first comma at depth 0.
    let i = m.index + 3;
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === "," && depth === 0) break;
    }
    const one = readString(src, skipSpace(src, i + 1));
    if (!one) continue;
    const comma = skipSpace(src, one.end);
    const other = src[comma] === "," ? readString(src, skipSpace(src, comma + 1)) : null;
    if (other) keys.set(`${one.value}|${other.value}`, path.basename(f));
  }
}

// Labels kept in data tables and translated with t(label) where shown.
const LABELS = [
  ...ACCOUNT_KINDS.map((k) => k.label),
  ...FREQUENCIES.map((f) => f.label),
  ...STARTER_CATEGORIES.map((c) => c.name),
  ...DEFAULT_CREDIT_CATEGORIES.map((c) => c.name),
  ...["bad signature", "404", "dns error", "os error 5"].map((e) => describeUpdateError(new Error(e))),
  describeUpdateError(new Error("os error 5"), "installing the update"),
];

it("finds the strings to check", () => {
  expect(keys.size).toBeGreaterThan(100);
});

describe.each(Object.entries(DICTS))("the %s dictionary", (lang, dict) => {
  it("covers every string the app translates", () => {
    const missing = [...keys.entries()].filter(([k]) => !(k in dict)).map(([k, f]) => `${f}: ${k}`);
    expect(missing).toEqual([]);
  });

  it("covers the labels that live in data tables", () => {
    expect(LABELS.filter((l) => !(l in dict))).toEqual([]);
  });

  it("has nothing the app no longer uses", () => {
    const used = new Set([...keys.keys(), ...LABELS, "{n} goal|{n} goals"]);
    expect(Object.keys(dict).filter((k) => !used.has(k))).toEqual([]);
  });

  it("gives every plural each of its forms", () => {
    const want = PLURAL_FORMS[lang].length;
    const bad = Object.entries(dict).filter(([k, v]) => k.includes("|") && v.split("|").length !== want).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("keeps each translation's placeholders", () => {
    // A plural's count may be spelled out in one form ("the month before")
    // and a number in another, so {n} is left out of the comparison - but the
    // form for larger numbers must show it whenever the English does.
    const names = (s) => [...new Set([...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).filter((n) => n !== "n"))].sort().join(",");
    const bad = Object.entries(dict).filter(([k, v]) => {
      const forms = v.split("|");
      if (k.includes("|") && k.split("|")[1].includes("{n}") && !forms[forms.length - 1].includes("{n}")) return true;
      return forms.some((form) => names(form) !== names(k));
    }).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("uses only placeholders the English has", () => {
    const all = (s) => new Set([...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]));
    const bad = Object.entries(dict).filter(([k, v]) => {
      const have = all(k);
      return [...all(v)].some((n) => !have.has(n));
    }).map(([k]) => k);
    expect(bad).toEqual([]);
  });
});
