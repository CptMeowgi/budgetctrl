// "What's new" after an update: the notes for each version come from
// CHANGELOG.md, the same text as the release page.

export const APP_VERSION = import.meta.env.APP_VERSION || "";
export const SEEN_VERSION_KEY = "budget-ctrl-seen-version";

// The changelog is bundled, and loaded only when it's shown.
export async function loadChangelog() {
  const m = await import("../../CHANGELOG.md?raw");
  return parseChangelog(m.default);
}

// At launch: the notes for what changed since the version last opened,
// once. The version is remembered as soon as it's read, so closing the app
// without reading them doesn't bring them back.
export async function whatsNewAtLaunch(hasBudget) {
  let lastSeen;
  try {
    lastSeen = localStorage.getItem(SEEN_VERSION_KEY);
    if (lastSeen === APP_VERSION) return [];
    localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
  } catch {
    // Nowhere to remember it: showing them every launch would be worse.
    return [];
  }
  return notesToShow(await loadChangelog(), { lastSeen, current: APP_VERSION, hasBudget });
}

// Every version up to this one, newest first, for Settings; in development
// also the notes not released yet.
export function allNotes(entries, dev = false) {
  return entries.filter((e) => (e.version === "Unreleased" ? dev : isVersion(e.version) && compareVersions(e.version, APP_VERSION) <= 0));
}

// The changelog as [{ version, blocks }], newest first. A block is a
// paragraph { type: "p", text }, a sub-heading { type: "h", text }, or a
// list { type: "ul", items: [{ text, items }] } with one level of nesting.
// Wrapped lines are joined. A quote reads as a paragraph, a table as a list
// of its rows, and a link as its text: the window shows text, not markup.
export function parseChangelog(md) {
  const entries = [];
  let entry = null;
  let block = null;
  let kind = null; // what the open block came from: p, quote, ul or table
  const close = () => { block = null; kind = null; };
  const open = (b, k) => { block = b; kind = k; entry.blocks.push(b); };
  const text = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
  for (const raw of String(md || "").split(/\r?\n/)) {
    const heading = raw.match(/^## (.+?)\s*$/);
    if (heading) {
      entry = { version: heading[1], blocks: [] };
      entries.push(entry);
      close();
      continue;
    }
    if (!entry) continue;
    const line = raw.replace(/\s+$/, "");
    if (!line || line === "---") { close(); continue; }
    const sub3 = line.match(/^#{3,}\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    const row = line.match(/^\|(.*)\|$/);
    const top = line.match(/^- (.*)$/);
    const sub = line.match(/^ {2,}- (.*)$/);
    if (sub3) {
      close();
      entry.blocks.push({ type: "h", text: text(sub3[1]) });
    } else if (row) {
      const cells = row[1].split("|").map((c) => text(c));
      if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
      // The first row of a table names its columns.
      if (kind !== "table") { close(); kind = "table"; continue; }
      if (!block) open({ type: "ul", items: [] }, "table");
      block.items.push({ text: cells.filter(Boolean).join(" — "), items: [] });
    } else if (quote) {
      if (kind === "quote") block.text += ` ${text(quote[1])}`;
      else { close(); open({ type: "p", text: text(quote[1]) }, "quote"); }
    } else if (top) {
      if (kind !== "ul") { close(); open({ type: "ul", items: [] }, "ul"); }
      block.items.push({ text: text(top[1]), items: [] });
    } else if (sub && kind === "ul") {
      block.items[block.items.length - 1].items.push(text(sub[1]));
    } else if (kind === "ul") {
      // A wrapped line belongs to the last item, or to its last sub-item.
      const item = block.items[block.items.length - 1];
      if (item.items.length && /^ {4,}/.test(line)) item.items[item.items.length - 1] += ` ${text(line)}`;
      else item.text += ` ${text(line)}`;
    } else if (kind === "p") {
      block.text += ` ${text(line)}`;
    } else {
      close();
      open({ type: "p", text: text(line) }, "p");
    }
  }
  return entries;
}

// Compares "0.10.0" with "0.9.1" by number. Anything that isn't a version
// sorts as 0.0.0.
export function compareVersions(a, b) {
  const parts = (v) => (String(v).match(/^\d+(\.\d+)*$/) ? String(v).split(".").map(Number) : [0]);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

const isVersion = (v) => /^\d+(\.\d+)*$/.test(v);

// Which versions' notes to show at launch. After an update: every version
// since the one last seen, up to this one. On a first install: none - the
// app is new, not changed. A budget that predates remembering versions
// sees this version's notes once.
export function notesToShow(entries, { lastSeen, current, hasBudget }) {
  if (!isVersion(current)) return [];
  if (!lastSeen) {
    return hasBudget ? entries.filter((e) => e.version === current) : [];
  }
  return entries.filter((e) => isVersion(e.version)
    && compareVersions(e.version, lastSeen) > 0 && compareVersions(e.version, current) <= 0);
}
