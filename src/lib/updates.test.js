import { describe, it, expect } from "vitest";
import { CHECK_EVERY_MS, dueForCheck, progressPercent, describeUpdateError, agoLabel, notesToLines } from "./updates.js";

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

describe("dueForCheck", () => {
  it("checks when it never has", () => {
    expect(dueForCheck(null, NOW)).toBe(true);
    expect(dueForCheck(NaN, NOW)).toBe(true);
  });

  it("waits a day between checks", () => {
    expect(dueForCheck(NOW - 23 * HOUR, NOW)).toBe(false);
    expect(dueForCheck(NOW - CHECK_EVERY_MS, NOW)).toBe(true);
  });

  it("is not silenced by a clock that was set backwards", () => {
    expect(dueForCheck(NOW + 5 * HOUR, NOW)).toBe(true);
  });
});

describe("progressPercent", () => {
  it("is a whole percent, never past 100", () => {
    expect(progressPercent(512, 2048)).toBe(25);
    expect(progressPercent(3000, 2048)).toBe(100);
  });

  it("is unknown while the size is", () => {
    expect(progressPercent(512, null)).toBe(null);
    expect(progressPercent(512, 0)).toBe(null);
  });
});

describe("describeUpdateError", () => {
  it("explains a missing release", () => {
    expect(describeUpdateError(new Error("Could not fetch a valid release JSON from the remote"))).toMatch(/published/);
  });

  it("explains being offline", () => {
    expect(describeUpdateError("error sending request for url (https://github.com/...)")).toMatch(/connection/);
  });

  it("explains a bad signature, which matters most", () => {
    expect(describeUpdateError("signature verification failed")).toMatch(/signature/);
  });

  it("falls back to something general rather than raw Rust text", () => {
    expect(describeUpdateError(new Error("os error 5"))).toBe("Something went wrong while checking for updates.");
    expect(describeUpdateError(undefined)).toBe("Something went wrong while checking for updates.");
  });

  it("says what was being done", () => {
    expect(describeUpdateError(new Error("os error 5"), "installing the update")).toBe("Something went wrong while installing the update.");
  });
});

describe("agoLabel", () => {
  it("reads naturally", () => {
    expect(agoLabel(NOW - 20 * 1000, NOW)).toBe("just now");
    expect(agoLabel(NOW - 60 * 1000, NOW)).toBe("1 minute ago");
    expect(agoLabel(NOW - 5 * HOUR, NOW)).toBe("5 hours ago");
    expect(agoLabel(NOW - 49 * HOUR, NOW)).toBe("2 days ago");
  });
});

describe("notesToLines", () => {
  it("turns changelog Markdown into headings, bullets and text", () => {
    const md = [
      "### Reports",
      "The Year tab is now **Reports**, and opens on",
      "this year.",
      "",
      "- **Top payees**, grouping one shop -",
      "  `BIEDRONKA 1234` and `Biedronka 77` are one place",
      "- Export CSV",
    ].join("\r\n");
    expect(notesToLines(md)).toEqual([
      { kind: "heading", text: "Reports" },
      { kind: "text", text: "The Year tab is now Reports, and opens on this year." },
      { kind: "bullet", text: "Top payees, grouping one shop - BIEDRONKA 1234 and Biedronka 77 are one place" },
      { kind: "bullet", text: "Export CSV" },
    ]);
  });

  it("is empty for no notes", () => {
    expect(notesToLines(undefined)).toEqual([]);
  });
});
