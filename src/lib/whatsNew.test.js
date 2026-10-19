import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { APP_VERSION, compareVersions, notesToShow, parseChangelog } from "./whatsNew.js";

const SAMPLE = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "- Something coming.",
  "",
  "## 0.6.0",
  "",
  "This release is about trust: a strict security policy",
  "and an easy way to tell me when something's wrong.",
  "",
  "- Settings has a new **About** section listing the open-source",
  "  software Budget Ctrl is built with.",
  "- The app now runs under a strict Content Security Policy:",
  "  - its own code only;",
  "  - no outside requests.",
  "",
  "---",
  "",
  "## 0.5.2",
  "",
  "- Storage safety.",
].join("\n");

describe("parseChangelog", () => {
  const entries = parseChangelog(SAMPLE);

  it("reads each version's section, newest first", () => {
    expect(entries.map((e) => e.version)).toEqual(["Unreleased", "0.6.0", "0.5.2"]);
  });

  it("joins wrapped lines into paragraphs and list items, keeping one level of nesting", () => {
    const v6 = entries[1];
    expect(v6.blocks).toEqual([
      { type: "p", text: "This release is about trust: a strict security policy and an easy way to tell me when something's wrong." },
      { type: "ul", items: [
        { text: "Settings has a new **About** section listing the open-source software Budget Ctrl is built with.", items: [] },
        { text: "The app now runs under a strict Content Security Policy:", items: ["its own code only;", "no outside requests."] },
      ] },
    ]);
  });

  it("reads sub-headings, quotes, tables and links as text, not markup", () => {
    const md = [
      "## 0.5.0", "", "> **Upgrading?** Your budget comes", "> with you.", "", "### A new look",
      "Everything is new.", "", "| Key | Does |", "|---|---|", "| Ctrl+F | Search everything |", "| N | New entry |", "",
      "See [the 0.4.0 notes](docs/releases/0.4.0.md) for more.",
    ].join("\n");
    expect(parseChangelog(md)[0].blocks).toEqual([
      { type: "p", text: "**Upgrading?** Your budget comes with you." },
      { type: "h", text: "A new look" },
      { type: "p", text: "Everything is new." },
      { type: "ul", items: [{ text: "Ctrl+F — Search everything", items: [] }, { text: "N — New entry", items: [] }] },
      { type: "p", text: "See the 0.4.0 notes for more." },
    ]);
  });

  it("leaves no markup in the real changelog's notes", () => {
    const texts = parseChangelog(readFileSync("CHANGELOG.md", "utf8")).flatMap((e) => e.blocks.flatMap((b) =>
      (b.type === "ul" ? b.items.flatMap((i) => [i.text, ...i.items]) : [b.text])));
    expect(texts.filter((x) => /^[#>|]/.test(x) || /\]\(/.test(x) || /\|\s*-{3}/.test(x))).toEqual([]);
  });

  it("has notes for the version being built, so a release's What's new isn't empty", () => {
    // Bumping the version in tauri.conf.json means renaming "## Unreleased" too.
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parseChangelog(readFileSync("CHANGELOG.md", "utf8")).map((e) => e.version)).toContain(APP_VERSION);
  });

  it("reads the real changelog: every released version has notes", () => {
    const real = parseChangelog(readFileSync("CHANGELOG.md", "utf8"));
    const released = real.filter((e) => e.version !== "Unreleased");
    expect(released.length).toBeGreaterThan(5);
    for (const e of released) expect(e.blocks.length).toBeGreaterThan(0);
    expect(released.map((e) => e.version)).toContain("0.6.0");
  });
});

describe("compareVersions", () => {
  it("orders by number, not text", () => {
    expect(compareVersions("0.10.0", "0.9.1")).toBeGreaterThan(0);
    expect(compareVersions("0.6.0", "0.6.0")).toBe(0);
    expect(compareVersions("0.5.2", "0.6.0")).toBeLessThan(0);
  });
});

describe("notesToShow", () => {
  const entries = parseChangelog(SAMPLE);
  const versions = (out) => out.map((e) => e.version);

  it("after an update, shows every version since the one last seen", () => {
    expect(versions(notesToShow(entries, { lastSeen: "0.5.1", current: "0.6.0", hasBudget: true }))).toEqual(["0.6.0", "0.5.2"]);
  });

  it("shows nothing when the version is the one last seen", () => {
    expect(notesToShow(entries, { lastSeen: "0.6.0", current: "0.6.0", hasBudget: true })).toEqual([]);
  });

  it("on a first install shows nothing; on the first launch that remembers versions, this one's notes", () => {
    expect(notesToShow(entries, { lastSeen: null, current: "0.6.0", hasBudget: false })).toEqual([]);
    expect(versions(notesToShow(entries, { lastSeen: null, current: "0.6.0", hasBudget: true }))).toEqual(["0.6.0"]);
  });

  it("never shows the notes still to be released, or a version going backwards", () => {
    expect(versions(notesToShow(entries, { lastSeen: "0.5.2", current: "0.6.0", hasBudget: true }))).toEqual(["0.6.0"]);
    expect(notesToShow(entries, { lastSeen: "0.6.0", current: "0.5.2", hasBudget: true })).toEqual([]);
  });

  it("shows nothing without a version to compare", () => {
    expect(notesToShow(entries, { lastSeen: "0.5.2", current: "", hasBudget: true })).toEqual([]);
  });
});
