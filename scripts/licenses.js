// Gathers the licence of every package Budget Ctrl is built from, for the
// "Open-source licences" list in Settings. Most of those licences (MIT,
// Apache-2.0, ISC, BSD, the font's OFL) ask for their notice to travel with
// the software, and a minified bundle or a compiled binary keeps none of them.
//
// Run it after adding or updating a dependency:
//   npm ci
//   cd src-tauri && cargo fetch --locked && cd ..
//   npm run licenses
//
// src/licenses.test.js fails when package-lock.json or Cargo.lock names a
// package that is missing here, so a forgotten run can't reach a release.
//
// Every package in the lockfiles is listed, not only what is compiled for
// Windows and Linux. Listing too much costs nothing, and it keeps that check
// simple enough to run where Rust isn't installed.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "licenses", "third-party.json");

// LICENSE, LICENSE-MIT, LICENCE.txt, COPYING, NOTICE, UNLICENSE... but not
// license.rs or license.json, which are code.
const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicense)([-._][\w.-]*)?$/i;
const NOT_TEXT = /\.(rs|js|mjs|cjs|ts|json|toml|ya?ml|html?|py|sh|c|h|go)$/i;

const clean = (text) => text.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();

function licenseFiles(dir, extra) {
  const names = new Set();
  for (const name of readdirSync(dir)) {
    if (LICENSE_FILE.test(name) && !NOT_TEXT.test(name) && statSync(join(dir, name)).isFile()) names.add(name);
  }
  if (extra && existsSync(join(dir, extra))) names.add(extra);
  return [...names].sort()
    .map((name) => ({ name, text: clean(readFileSync(join(dir, name), "utf8")) }))
    .filter((f) => f.text);
}

// Which licence a file holds, judged by its wording. A file holding more than
// one, or none of these, is "other" and is always kept.
function kindOf(text) {
  // Unicode's licence opens with MIT's wording, so it is looked for first.
  if (/UNICODE LICENSE V3|UNICODE, INC\. LICENSE AGREEMENT|Unicode Data Files/i.test(text)) return "Unicode-3.0";
  const found = [
    /Apache License/i.test(text) && /Version 2\.0/.test(text) && "Apache-2.0",
    /Permission is hereby granted, free of charge/i.test(text) && "MIT",
    /Permission to use, copy, modify, and(\/or)? distribute this software for any/i.test(text) && "ISC",
    /Redistribution and use in source and binary forms/i.test(text) && (/Neither the name/i.test(text) ? "BSD-3-Clause" : "BSD-2-Clause"),
    /altered source versions must be plainly marked/i.test(text) && "Zlib",
    /Mozilla Public License/i.test(text) && "MPL-2.0",
    /free and unencumbered software released into the public domain/i.test(text) && "Unlicense",
  ].filter(Boolean);
  return found.length === 1 ? found[0] : "other";
}
const same = (kind, id) => kind === id || (kind === "MIT" && id === "MIT-0");

// A package licensed "MIT OR Apache-2.0" can be used under either, so only
// the chosen licence's file is needed; shipping both doubles the list for
// nothing. NOTICE files, and files that can't be told apart, always stay.
function chosenTexts(p) {
  const files = p.files.map((f) => ({ ...f, kind: /^(notice|copyright)/i.test(f.name) ? "notice" : kindOf(f.text) }));
  const keep = files.filter((f) => f.kind === "notice" || f.kind === "other");
  const options = choices(p.license).sort((a, b) => Math.min(...a.map(rank)) - Math.min(...b.map(rank)));
  for (const option of options) {
    const picked = option.map((id) => files.find((f) => same(f.kind, id)));
    if (picked.every(Boolean)) return [...new Set([...picked, ...keep])].map((f) => f.text);
  }
  return files.map((f) => f.text);
}

// "MIT OR Apache-2.0", "MIT/Apache-2.0", "(MIT OR Apache-2.0) AND Unicode-3.0":
// the ways the package can be used, each a list of licences that all apply -
// here [["MIT", "Unicode-3.0"], ["Apache-2.0", "Unicode-3.0"]]. AND binds
// tighter than OR, as in SPDX. Exceptions ("WITH LLVM-exception") only add
// permissions, so they are dropped.
export function choices(expression) {
  const tokens = (expression || "")
    .replace(/\s+WITH\s+[\w.+-]+/g, "")
    .replace(/\s*\/\s*/g, " OR ")
    .match(/\(|\)|[^\s()]+/g) || [];
  let i = 0;
  const factor = () => {
    if (tokens[i] === "(") { i++; const inner = or(); i++; return inner; }
    return [[tokens[i++]]];
  };
  const and = () => {
    let left = factor();
    while (tokens[i] === "AND") {
      i++;
      const right = factor();
      left = left.flatMap((a) => right.map((b) => [...a, ...b]));
    }
    return left;
  };
  const or = () => {
    let alternatives = and();
    while (tokens[i] === "OR") { i++; alternatives = [...alternatives, ...and()]; }
    return alternatives;
  };
  return tokens.length ? or().filter((c) => c.every(Boolean)) : [];
}

// For the rare package that ships no licence file. The texts that name a
// copyright holder are filled in with the package's own authors, never
// borrowed from another project.
const TEMPLATES = {
  MIT: (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  ISC: (holder) => `ISC License

Copyright (c) ${holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  "BSD-3-Clause": (holder) => `BSD 3-Clause License

Copyright (c) ${holder}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
};
// Texts with no project-specific holder in them, taken from a package that
// ships the licence on its own, so the wording is the licence's own.
const CANONICAL = new Set(["Apache-2.0", "MPL-2.0", "CC0-1.0", "Unlicense"]);
const PREFERENCE = ["MIT", "Apache-2.0", "ISC", "BSD-3-Clause", "BSD-2-Clause", "Zlib", "0BSD", "MIT-0", "Unicode-3.0", "MPL-2.0", "CC0-1.0", "Unlicense"];
const rank = (id) => (PREFERENCE.indexOf(id) === -1 ? PREFERENCE.length : PREFERENCE.indexOf(id));

const holderOf = (authors, name) => {
  const people = (authors || []).map((a) => String(a).replace(/\s*<[^>]*>/g, "").replace(/\s*\([^)]*\)/g, "").trim()).filter(Boolean);
  return people.length ? people.join(", ") : `the ${name} authors`;
};

// ------------------------------------------------------------------ npm

function npmPackages() {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const out = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path || entry.dev || entry.devOptional) continue;
    const dir = join(ROOT, path);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
    const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    out.push({
      source: "npm",
      name: pkg.name,
      version: pkg.version,
      license: pkg.license || entry.license || "",
      url: `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
      repository: normalizeRepo(repo),
      holder: holderOf([author, ...(pkg.contributors || []).map((c) => (typeof c === "string" ? c : c.name))].filter(Boolean), pkg.name),
      files: licenseFiles(dir),
    });
  }
  return out;
}

function normalizeRepo(url) {
  if (!url) return null;
  let u = url.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@/, "https://");
  if (/^github:/.test(u)) u = `https://github.com/${u.slice(7)}`;
  if (/^[\w-]+\/[\w.-]+$/.test(u)) u = `https://github.com/${u}`;
  return /^https?:\/\//.test(u) ? u : null;
}

// --------------------------------------------------------------- crates

function cratePackages() {
  const json = execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--offline"], {
    cwd: join(ROOT, "src-tauri"), encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  const meta = JSON.parse(json);
  return meta.packages
    .filter((p) => p.source && p.source.startsWith("registry+"))
    .map((p) => ({
      source: "crates.io",
      name: p.name,
      version: p.version,
      license: p.license || "",
      url: `https://crates.io/crates/${p.name}/${p.version}`,
      repository: normalizeRepo(p.repository),
      holder: holderOf(p.authors, p.name),
      files: licenseFiles(dirname(p.manifest_path), p.license_file),
    }));
}

// Compiled into every Rust program, so it ships inside the app too.
const RUST_STD = {
  source: "rust",
  name: "Rust standard library",
  version: "",
  license: "MIT OR Apache-2.0",
  url: "https://github.com/rust-lang/rust",
  repository: "https://github.com/rust-lang/rust",
  holder: "The Rust Project Developers",
  files: [],
};

// --------------------------------------------------------------- output

function main() {
  const packages = [...npmPackages(), ...cratePackages(), RUST_STD];
  for (const p of packages) p.texts = p.files.length ? chosenTexts(p) : [];

  // Wording for the licences that name no holder, from a package that ships
  // exactly one licence and exactly one file.
  const canonical = {};
  for (const p of [...packages].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))) {
    const c = choices(p.license);
    if (c.length === 1 && c[0].length === 1 && p.texts.length === 1 && CANONICAL.has(c[0][0]) && !canonical[c[0][0]]) {
      canonical[c[0][0]] = p.texts[0];
    }
  }
  const fallback = (id, p) => (TEMPLATES[id] ? TEMPLATES[id](p.holder) : canonical[id] || null);

  const missing = [];
  for (const p of packages) {
    if (p.texts.length) continue;
    // Pick the first choice whose every licence can be written out.
    const usable = choices(p.license)
      .map((all) => ({ all, texts: all.map((id) => fallback(id, p)) }))
      .filter((c) => c.texts.every(Boolean))
      .sort((a, b) => Math.min(...a.all.map(rank)) - Math.min(...b.all.map(rank)));
    if (usable.length) p.texts = usable[0].texts;
    else missing.push(`${p.name}@${p.version} (${p.license || "no licence field"})`);
  }

  const texts = [];
  const index = new Map();
  // Copies that differ only in line wrapping are the same text.
  const ref = (text) => {
    const key = text.replace(/\s+/g, " ");
    if (!index.has(key)) { index.set(key, texts.length); texts.push(text); }
    return index.get(key);
  };
  const order = { npm: 0, "crates.io": 1, rust: 2 };
  const list = packages
    .sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }))
    .map((p) => ({
      source: p.source, name: p.name, version: p.version, license: p.license,
      url: p.url, ...(p.repository && p.repository !== p.url ? { repository: p.repository } : {}),
      texts: p.texts.map(ref),
    }));

  mkdirSync(dirname(OUT), { recursive: true });
  const body = JSON.stringify({ packages: list, texts }, null, 1) + "\n";
  writeFileSync(OUT, body);
  const bySource = list.reduce((a, p) => ({ ...a, [p.source]: (a[p.source] || 0) + 1 }), {});
  console.log(`${list.length} packages (${Object.entries(bySource).map(([k, v]) => `${v} ${k}`).join(", ")}), ${texts.length} distinct licence texts, ${(body.length / 1024).toFixed(0)} KB -> ${OUT}`);
  if (missing.length) {
    console.error(`No licence text found for:\n  ${missing.join("\n  ")}`);
    process.exitCode = 1;
  }
}

// Run as a script; imported by its test, it only lends its parser.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
