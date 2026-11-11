import { describe, expect, it } from "vitest";
import { SETTINGS_SECTIONS, sectionAfterKey } from "./settingsSections.js";

describe("settings sections", () => {
  it("opens on Budget and has unique ids", () => {
    expect(SETTINGS_SECTIONS[0].id).toBe("budget");
    expect(new Set(SETTINGS_SECTIONS.map((x) => x.id)).size).toBe(SETTINGS_SECTIONS.length);
  });
  it("moves with the arrow keys and wraps", () => {
    const last = SETTINGS_SECTIONS.length - 1;
    expect(sectionAfterKey(0, "ArrowDown")).toBe(1);
    expect(sectionAfterKey(last, "ArrowDown")).toBe(0);
    expect(sectionAfterKey(0, "ArrowUp")).toBe(last);
    expect(sectionAfterKey(2, "Home")).toBe(0);
    expect(sectionAfterKey(2, "End")).toBe(last);
    expect(sectionAfterKey(2, "a")).toBeNull();
  });
});
