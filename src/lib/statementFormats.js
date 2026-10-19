// Bank statement files other than CSV: MT940 (most Polish and German banks),
// OFX and QFX (common worldwide), and CAMT.053 (the EU's XML statement).
// Each is read into the same transactions as a CSV - { date, name, note,
// amount }, money out negative - so the matching that stops double counting,
// and the import rules, work the same whatever the format.

import { parseAmount } from "./importer.js";

export function detectFormat(text) {
  const head = String(text || "").slice(0, 4000);
  if (/<(?:[\w.-]+:)?BkToCstmrStmt[\s>]/.test(head) || /camt\.053/i.test(head)) return "camt053";
  if (/OFXHEADER|<OFX>/i.test(head)) return "ofx";
  if (/^:20:/m.test(head) && /^:61:/m.test(text)) return "mt940";
  return "csv";
}

export function parseStatement(text, format) {
  const read = { mt940: mt940, ofx, camt053: camt }[format];
  const out = read ? read(String(text || "")) : { transactions: [], skipped: 0 };
  return { ...out, format };
}

// ------------------------------------------------------------------ shared

const iso = (y, m, d) => {
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

// The same naming as a CSV import: the other side's name when there is one,
// the title as its note; otherwise the title is the name.
function transaction(date, amount, payee, title) {
  const who = squash(payee);
  const what = squash(title);
  return {
    date,
    name: (who || what || "Imported transaction").slice(0, 80),
    note: who && what && what !== who ? what.slice(0, 200) : undefined,
    amount: Math.round(amount * 100) / 100,
  };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s) => String(s || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);

// ------------------------------------------------------------------- MT940

// Fields start a line with :TAG:; any other line continues the field before.
function mt940Fields(text) {
  const fields = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const tag = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (tag) fields.push({ tag: tag[1], lines: [tag[2]] });
    else if (fields.length && line && line !== "-" && !/^[{}-]/.test(line)) fields[fields.length - 1].lines.push(line);
  }
  return fields;
}

// :86: either has numbered parts - 020~00TYPE~20title~32name (Polish ZBP,
// with ~ ^ or <) or ?20 (German) - or is free text, maybe with /NAME/ and
// /REMI/ codes. Parts can wrap onto the next line mid-word, so lines are
// joined as they are; free text is joined with spaces.
function mt940Details(lines) {
  const joined = lines.join("");
  const sep = joined.match(/^(?:\d{3})?([~^?<])\d{2}/)?.[1];
  if (sep) {
    const parts = {};
    const pieces = joined.split(new RegExp(`\\${sep}(\\d{2})`));
    for (let i = 1; i < pieces.length; i += 2) (parts[pieces[i]] ||= []).push(pieces[i + 1]);
    const pick = (codes) => codes.flatMap((c) => parts[c] || []).map(squash).filter(Boolean).join(" ");
    const title = pick(["20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "60", "61", "62", "63"]);
    return { payee: pick(["32", "33"]), title: title || pick(["00"]) };
  }
  const free = lines.join(" ");
  if (/\/(NAME|REMI)\//.test(free)) {
    const code = (c) => free.match(new RegExp(`/${c}/([^/]*)`))?.[1] || "";
    return { payee: code("NAME"), title: code("REMI") };
  }
  return { payee: "", title: free };
}

function mt940(text) {
  const transactions = [];
  let skipped = 0;
  const fields = mt940Fields(text);
  fields.forEach((f, i) => {
    if (f.tag !== "61") return;
    // Value date YYMMDD, an optional booking date MMDD, then C, D, RC or RD,
    // an optional third letter of the currency, and the amount.
    const m = f.lines[0].match(/^(\d{2})(\d{2})(\d{2})(?:\d{4})?(R?[CD])[A-Z]?(\d+,\d*)/);
    const date = m && iso(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
    const value = m && parseAmount(m[5]);
    if (!date || !value) { skipped++; return; }
    // A reversal of a credit takes money out, and of a debit puts it back.
    const out = m[4] === "D" || m[4] === "RC";
    const next = fields[i + 1];
    const { payee, title } = next?.tag === "86" ? mt940Details(next.lines) : { payee: "", title: "" };
    transactions.push(transaction(date, out ? -value : value, payee, title));
  });
  return { transactions, skipped };
}

// --------------------------------------------------------------------- OFX

// OFX 1 is SGML, where a value runs to the next tag or line end; OFX 2 is
// XML. Reading a value up to the next "<" covers both.
function ofx(text) {
  const transactions = [];
  let skipped = 0;
  for (const [, block] of text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)) {
    const leaf = (tag) => unescape(block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"))?.[1] || "").trim();
    const d = leaf("DTPOSTED").match(/^(\d{4})(\d{2})(\d{2})/);
    const date = d && iso(Number(d[1]), Number(d[2]), Number(d[3]));
    const amount = parseAmount(leaf("TRNAMT"));
    if (!date || !amount) { skipped++; continue; }
    transactions.push(transaction(date, amount, leaf("NAME"), leaf("MEMO")));
  }
  return { transactions, skipped };
}

// ---------------------------------------------------------------- CAMT.053

// The elements this needs, with or without a namespace prefix.
const tagRe = (tag) => new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, "g");
const blocks = (xml, tag) => [...String(xml || "").matchAll(tagRe(tag))].map((m) => m[1]);
const first = (xml, ...path) => path.reduce((x, tag) => (x == null ? null : blocks(x, tag)[0] ?? null), xml);
const plain = (xml) => (xml == null ? "" : squash(unescape(String(xml).replace(/<[^>]+>/g, " "))));

function camt(text) {
  const transactions = [];
  let skipped = 0;
  for (const entry of blocks(text, "Ntry")) {
    // Only what the bank has booked; a pending entry may still change.
    const status = plain(first(entry, "Sts"));
    if (status && status !== "BOOK") { skipped++; continue; }
    const out = plain(first(entry, "CdtDbtInd")) === "DBIT";
    const amount = parseAmount(plain(first(entry, "Amt")));
    const when = first(entry, "BookgDt") ?? first(entry, "ValDt");
    const d = plain(first(when, "Dt") ?? first(when, "DtTm")).match(/^(\d{4})-(\d{2})-(\d{2})/);
    const date = d && iso(Number(d[1]), Number(d[2]), Number(d[3]));
    if (!date || !amount) { skipped++; continue; }
    const tx = first(entry, "NtryDtls", "TxDtls");
    // The other side: who was paid for money out, who paid for money in.
    const party = first(first(tx, "RltdPties"), out ? "Cdtr" : "Dbtr");
    const title = blocks(first(tx, "RmtInf"), "Ustrd").map(plain).join(" ")
      || plain(first(tx, "AddtlTxInf")) || plain(first(entry, "AddtlNtryInf"));
    transactions.push(transaction(date, out ? -Math.abs(amount) : Math.abs(amount), plain(first(party, "Nm")), title));
  }
  return { transactions, skipped };
}
