import { describe, it, expect } from "vitest";
import { createEpoch } from "./epoch.js";

describe("createEpoch", () => {
  it("keeps a check good until a close, and stale after it", () => {
    const epoch = createEpoch();
    const still = epoch.check();
    expect(still()).toBe(true);
    expect(still()).toBe(true);
    epoch.bump();
    expect(still()).toBe(false);
    // A check taken after the close is good again.
    const after = epoch.check();
    expect(after()).toBe(true);
    epoch.bump();
    expect(after()).toBe(false);
    expect(still()).toBe(false);
  });

  it("counts the closes", () => {
    const epoch = createEpoch();
    expect(epoch.bump()).toBe(1);
    expect(epoch.bump()).toBe(2);
  });

  it("keeps each count to itself", () => {
    const a = createEpoch();
    const b = createEpoch();
    const still = a.check();
    b.bump();
    expect(still()).toBe(true);
  });
});
