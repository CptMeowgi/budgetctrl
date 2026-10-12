import { describe, it, expect } from "vitest";
import { reflowChanges } from "./reflow.js";

const layout = (w, items) => ({ box: { w, h: 400 }, items });
const card = (x, y, w, h = 300) => ({ x, y, w, h });

describe("reflowChanges", () => {
  it("ignores the small changes of an ordinary resize", () => {
    expect(reflowChanges(layout(900, [card(0, 0, 580), card(598, 0, 302)]), layout(895, [card(0, 0, 577), card(595, 0, 300)]))).toEqual([]);
  });

  it("sees a card pushed down to the next row, and the one that grows into its space", () => {
    const sideBySide = layout(838, [card(0, 0, 520), card(538, 0, 300)]);
    const stacked = layout(836, [card(0, 0, 836), card(0, 318, 836)]);
    expect(reflowChanges(sideBySide, stacked)).toEqual([
      { index: 0, kind: "grow", from: 520, to: 836 },
      { index: 1, kind: "move", dx: 538, dy: -318 },
    ]);
  });

  it("sees the card coming back up, and the one it squeezes", () => {
    const stacked = layout(836, [card(0, 0, 836), card(0, 318, 836)]);
    const sideBySide = layout(840, [card(0, 0, 521), card(539, 0, 301)]);
    expect(reflowChanges(stacked, sideBySide)).toEqual([
      { index: 0, kind: "shrink", from: 836, to: 521 },
      { index: 1, kind: "move", dx: -539, dy: 318 },
    ]);
  });

  it("does nothing for a window coming back from minimised", () => {
    expect(reflowChanges(layout(0, [card(0, 0, 0)]), layout(900, [card(0, 0, 900)]))).toEqual([]);
  });

  it("skips cards that weren't there before", () => {
    expect(reflowChanges(layout(900, [card(0, 0, 900)]), layout(900, [card(0, 0, 900), card(0, 318, 900)]))).toEqual([]);
  });
});
