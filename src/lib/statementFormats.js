// Bank statement files other than CSV: MT940 (most Polish and German banks),
// OFX and QFX (common worldwide), and CAMT.053 (the EU's XML statement).
// Each is read into the same transactions as a CSV - { date, name, note,
// amount }, money out negative - so the matching that stops double counting,
// and the import rules, work the same whatever the format.

import { parseAmount } from "./amounts.js";

// By how the file starts, so a CSV that merely mentions a format in one of
// its cells stays a CSV.
export function detectFormat(text) {
  const head = String(text || "").replace(/^\uFEFF/, "").trimStart().slice(0, 4000);
  if (head.startsWith("<")) {
    // camt.053 statements, and the camt.052 reports and camt.054
    // notifications that list entries the same way.
    if (/<(?:[\w.-]+:)?BkToCstmr(?:Stmt|AcctRpt|DbtCdtNtfctn)[\s>]/.test(head)) return "camt053";
    if (/<OFX[\s>]|OFXHEADER/i.test(head)) return "ofx";
    return "csv";
  }
  if (/^OFXHEADER:/i.test(head)) return "ofx";
  if (/^(?:\{1:|:20:)/.test(head)) return "mt940";
  return "csv";
}

// { transactions, skipped, pending, format }: skipped counts entries that
// couldn't be read, pending those the bank hasn't booked yet.
export function parseStatement(text, format) {
  const read = { mt940: mt940, ofx, camt053: camt }[format];
  const out = read ? read(String(text || "")) : { transactions: [], skipped: 0 };
  return { pending: 0, ...out, format };
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
// A line keeps its spaces: one wrapped after a space must keep it. The
// SWIFT header ({1:...) and the "-" or "-}" that ends a message are not text.
function mt940Fields(text) {
  const fields = [];
  for (const line of text.split(/\r?\n/)) {
    const tag = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (tag) fields.push({ tag: tag[1], lines: [tag[2]] });
    else if (fields.length && line.trim() && !/^-\}?$/.test(line.trim()) && !/^\{\d:/.test(line)) fields[fields.length - 1].lines.push(line);
  }
  return fields;
}

// :86: either has numbered parts - 020~00TYPE~20title~32name (Polish ZBP,
// with ~ ^ or <) or ?20 (German) - or is free text, maybe with /NAME/ and
// /REMI/ codes. Parts can wrap onto the next line mid-word, so lines are
// joined as they are; free text is joined with spaces.
const SWIFT_CODES = /\/(TRTP|IBAN|BIC|NAME|ADDR|REMI|EREF|ORDP|BENM|MARF|CSID|PURP|RTRN|ISDT|CNTP|SVCL)\//;

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
    // Each code's text runs to the next code, so a slash inside a name or
    // an invoice number stays. REMI may start with USTD// or STRD/CUR/.
    const pieces = free.split(SWIFT_CODES);
    const code = (c) => {
      const i = pieces.indexOf(c);
      return i > 0 && i % 2 === 1 ? pieces[i + 1].replace(/\/+\s*$/, "") : "";
    };
    return { payee: code("NAME"), title: code("REMI").replace(/^USTD\/\/?/, "").replace(/^STRD\/[A-Z]*\//, "") };
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
// Text with its tags gone; CDATA is text as it stands.
const plain = (xml) => {
  if (xml == null) return "";
  const parts = String(xml).split(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return squash(parts.map((p, i) => (i % 2 ? p : unescape(p.replace(/<[^>]+>/g, " ")))).join(""));
};

// One payment's details: the other side (who was paid for money out, who
// paid for money in) and what it was for.
function camtDetails(tx, out) {
  const party = first(first(tx, "RltdPties"), out ? "Cdtr" : "Dbtr");
  const title = blocks(first(tx, "RmtInf"), "Ustrd").map(plain).join(" ") || plain(first(tx, "AddtlTxInf"));
  return { payee: plain(first(party, "Nm")), title };
}

function camt(text) {
  const transactions = [];
  let skipped = 0;
  let pending = 0;
  for (const entry of blocks(text, "Ntry")) {
    // Only what the bank has booked; a pending entry may still change.
    const status = plain(first(entry, "Sts"));
    if (status && status !== "BOOK") { pending++; continue; }
    const out = plain(first(entry, "CdtDbtInd")) === "DBIT";
    const amount = parseAmount(plain(first(entry, "Amt")));
    const when = first(entry, "BookgDt") ?? first(entry, "ValDt");
    const d = plain(first(when, "Dt") ?? first(when, "DtTm")).match(/^(\d{4})-(\d{2})-(\d{2})/);
    const date = d && iso(Number(d[1]), Number(d[2]), Number(d[3]));
    if (!date || !amount) { skipped++; continue; }
    const signed = (value, isOut) => (isOut ? -Math.abs(value) : Math.abs(value));
    const note = plain(first(entry, "AddtlNtryInf"));
    const txs = blocks(entry, "TxDtls");
    // A batch - several payments booked as one entry - is split when each
    // payment says its amount, so each can match what was entered for it.
    // Otherwise it stays one, named by the entry rather than its first payee.
    const each = txs.map((tx) => parseAmount(plain(first(tx, "AmtDtls", "TxAmt", "Amt") ?? first(tx, "Amt"))));
    if (txs.length > 1 && each.every((v) => v)) {
      txs.forEach((tx, i) => {
        const ind = plain(first(tx, "CdtDbtInd"));
        const isOut = ind ? ind === "DBIT" : out;
        const { payee, title } = camtDetails(tx, isOut);
        transactions.push(transaction(date, signed(each[i], isOut), payee, title || note));
      });
      continue;
    }
    const { payee, title } = txs.length === 1 ? camtDetails(txs[0], out) : { payee: "", title: "" };
    transactions.push(transaction(date, signed(amount, out), payee, title || note));
  }
  return { transactions, skipped, pending };
}
