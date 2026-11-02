import { describe, expect, it } from "vitest";
import { afterSave, needsReplace, stampFor } from "./saving.js";

const HH = "household";

describe("stampFor", () => {
  it("stamps a doc made fresh for the open budget", () => {
    expect(stampFor({ months: {} }, HH)).toEqual({ months: {}, budgetOf: HH });
  });

  it("keeps the stamp an edit carries, and the doc itself", () => {
    const doc = { months: {}, budgetOf: HH, budgetGen: 7 };
    expect(stampFor(doc, HH)).toBe(doc);
  });

  it("gives nothing for a doc of a budget that isn't open", () => {
    expect(stampFor({ months: {}, budgetOf: "anna1" }, HH)).toBeNull();
  });
});

describe("needsReplace", () => {
  it("is false for a snapshot of the budget's own generation", () => {
    expect(needsReplace({ budgetGen: 5 }, { budgetGen: 5 })).toBe(false);
  });

  it("is true for a snapshot from another generation, or none", () => {
    expect(needsReplace({ budgetGen: 4 }, { budgetGen: 5 })).toBe(true);
    expect(needsReplace({}, { budgetGen: 5 })).toBe(true);
  });

  it("is false when the store holds no open budget to compare with", () => {
    expect(needsReplace({ budgetGen: 4 }, null)).toBe(false);
  });
});

describe("afterSave", () => {
  const doc = { n: 1 };
  const stored = { n: 1, budgetGen: 9 };
  const held = { n: 0 };

  it("shows the doc as stored when it came back as another object and nothing newer is shown", () => {
    expect(afterSave({ doc, stored, shown: doc, held: stored })).toEqual({ show: stored, refused: false });
  });

  it("shows nothing new when the store kept the doc as it was sent", () => {
    expect(afterSave({ doc, stored: doc, shown: doc, held: doc })).toEqual({ show: null, refused: false });
  });

  it("never shows it over a newer edit", () => {
    const newer = { n: 2 };
    expect(afterSave({ doc, stored, shown: newer, held: stored })).toEqual({ show: null, refused: false });
  });

  it("always shows a whole budget once the store has it", () => {
    const before = { n: 0 };
    expect(afterSave({ doc, stored, replaced: true, shown: before, held: stored })).toEqual({ show: stored, refused: false });
  });

  it("shows what the store holds and says so when the doc is refused", () => {
    expect(afterSave({ doc, stored: false, shown: doc, held })).toEqual({ show: held, refused: true });
  });

  it("shows what the store holds without saying so when the write failed", () => {
    expect(afterSave({ doc, stored: null, shown: doc, held })).toEqual({ show: held, refused: false });
    expect(afterSave({ doc, stored: null, shown: doc, held: doc })).toEqual({ show: null, refused: false });
  });

  it("leaves a newer edit on screen when an older one is refused, and still says so", () => {
    const newer = { n: 2 };
    expect(afterSave({ doc, stored: false, shown: newer, held })).toEqual({ show: null, refused: true });
  });

  it("puts back what the store holds after a whole budget is refused, whatever is shown", () => {
    expect(afterSave({ doc, stored: false, replaced: true, shown: { n: 2 }, held })).toEqual({ show: held, refused: true });
  });
});
