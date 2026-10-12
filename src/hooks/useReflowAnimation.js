import { useLayoutEffect } from "react";
import { reflowChanges } from "../lib/reflow.js";

// Cards in a wrapping row glide to their new place when a resize moves them
// between rows, instead of jumping there, like a bubble being squeezed:
//   - the card that is pushed out is squashed as it goes and wobbles as it
//     lands;
//   - the card left behind grows into the space it freed;
//   - a card that has to make room again gives a little squeeze.
//
// `ref` is the row's container. It must be position: relative, so each
// card's offsetLeft/Top are measured from it and ignore animations already
// running. People who ask for reduced motion get the plain jump.

const EASE = "cubic-bezier(.22, 1, .36, 1)";

function measure(box) {
  return {
    box: { w: box.offsetWidth, h: box.offsetHeight },
    items: [...box.children].map((el) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })),
  };
}

function play(el, change) {
  for (const a of el.getAnimations()) if (a.id === "reflow") a.cancel();
  let animation;
  if (change.kind === "move") {
    animation = el.animate([
      { transform: `translate(${change.dx}px, ${change.dy}px) scale(.94, 1.05)` },
      { transform: "translate(0, 0) scale(1.025, .975)", offset: 0.7 },
      { transform: "none" },
    ], { duration: 560, easing: EASE });
  } else if (change.kind === "grow") {
    // Laid out at its new width at once; the part it grew by is revealed.
    const radius = getComputedStyle(el).borderRadius || "0";
    animation = el.animate([
      { clipPath: `inset(0 ${change.to - change.from}px 0 0 round ${radius})` },
      { clipPath: `inset(0 0 0 0 round ${radius})` },
    ], { duration: 480, easing: EASE });
  } else {
    animation = el.animate([
      { transform: "scale(1.03, .97)", transformOrigin: "left center" },
      { transform: "none", transformOrigin: "left center" },
    ], { duration: 380, easing: EASE });
  }
  animation.id = "reflow";
}

export function useReflowAnimation(ref) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === "undefined" || !box.animate) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let last = measure(box);
    const observer = new ResizeObserver(() => {
      const now = measure(box);
      if (!still?.matches) {
        for (const change of reflowChanges(last, now)) {
          const el = box.children[change.index];
          if (el) play(el, change);
        }
      }
      last = now;
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [ref]);
}
