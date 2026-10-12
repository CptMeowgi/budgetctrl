import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import notices from "./licenses/third-party.json";

// The licence list in Settings must cover everything the app is built from.
// When one of these fails, a dependency changed without `npm run licenses`
// (see scripts/licenses.js for the steps).

const listed = (source) => new Set(notices.packages.filter((p) => p.source === source).map((p) => `${p.name}@${p.version}`));

describe("open-source licences", () => {
  it("lists every npm package the app ships", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const shipped = Object.entries(lock.packages)
      .filter(([path, entry]) => path && !entry.dev && !entry.devOptional)
      .map(([path, entry]) => `${entry.name || path.replace(/^.*node_modules\//, "")}@${entry.version}`);
    expect(shipped.length).toBeGreaterThan(0);
    const have = listed("npm");
    expect(shipped.filter((p) => !have.has(p))).toEqual([]);
  });

  it("lists every Rust crate in Cargo.lock", () => {
    const lock = readFileSync("src-tauri/Cargo.lock", "utf8").replace(/\r\n/g, "\n");
    const crates = lock.split("\n[[package]]\n").slice(1)
      .filter((block) => /^source = "registry\+/m.test(block))
      .map((block) => `${/^name = "(.+)"$/m.exec(block)[1]}@${/^version = "(.+)"$/m.exec(block)[1]}`);
    expect(crates.length).toBeGreaterThan(100);
    const have = listed("crates.io");
    expect(crates.filter((c) => !have.has(c))).toEqual([]);
  });

  it("gives every package at least one licence text", () => {
    const bare = notices.packages.filter((p) => !p.texts.length || p.texts.some((i) => !notices.texts[i]));
    expect(bare.map((p) => p.name)).toEqual([]);
  });

  it("includes the Rust standard library, which is compiled into the app", () => {
    expect(notices.packages.some((p) => p.source === "rust" && p.license.includes("MIT"))).toBe(true);
  });
});
