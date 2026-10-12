// What each card in a wrapping row did when the window was resized: moved to
// another row, or grew or shrank where it is. Positions are relative to the
// row's container, and transforms are left out, so a card already in motion
// is judged by where the layout puts it.
//
// The ordinary resize of every frame is a pixel or two and counts as nothing;
// only a jump - a card wrapping, or the space it shared being freed - does.

// before/after: { box: { w, h }, items: [{ x, y, w, h }] }
export function reflowChanges(before, after, { rowShift = 8, sizeShift = 0.12 } = {}) {
  // A window coming back from minimised has nothing sensible to animate from.
  if (!before?.box.w || !after?.box.w) return [];
  const out = [];
  after.items.forEach((now, index) => {
    const was = before.items[index];
    if (!was) return;
    if (Math.abs(now.y - was.y) > rowShift) {
      out.push({ index, kind: "move", dx: was.x - now.x, dy: was.y - now.y });
    } else if (now.w > was.w * (1 + sizeShift)) {
      out.push({ index, kind: "grow", from: was.w, to: now.w });
    } else if (now.w < was.w * (1 - sizeShift)) {
      out.push({ index, kind: "shrink", from: was.w, to: now.w });
    }
  });
  return out;
}
