import { createContext, useCallback, useContext, useState } from "react";

const KEY = "budget-ctrl-collapsed-groups";

// The budget that is open: "household", or the person whose own budget it is.
// App provides it, so collapsed groups are remembered per budget without every
// screen in between passing it down.
export const OpenBudgetContext = createContext("household");

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
};

// An own budget's group names are its own, and a sealed one's are private, so
// they are never written down: kept in memory until the app closes, under
// "<person id>:<screen>". The household's are kept on this computer, under
// the screen's name, as they always were.
const ownMemory = new Map();
const isHousehold = (budget) => !budget || budget === "household";
const recall = (budget, surface) => new Set(isHousehold(budget) ? read()[surface] || [] : ownMemory.get(`${budget}:${surface}`) || []);
const keep = (budget, surface, groups) => {
  if (!isHousehold(budget)) { ownMemory.set(`${budget}:${surface}`, groups); return; }
  try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [surface]: groups })); } catch { /* kept for this session only */ }
};

// Which category groups are collapsed on one screen ("dashboard",
// "reports"). It's how you like to look at things, not part of the budget,
// so it never makes an undo step.
export function useCollapsed(surface) {
  const budget = useContext(OpenBudgetContext);
  const [state, setState] = useState(() => ({ budget, collapsed: recall(budget, surface) }));
  // Another budget opened: its own memory, read as the screen draws.
  let current = state;
  if (state.budget !== budget) {
    current = { budget, collapsed: recall(budget, surface) };
    setState(current);
  }
  const toggle = useCallback((group) => setState((cur) => {
    const next = new Set(cur.collapsed);
    if (next.has(group)) next.delete(group); else next.add(group);
    keep(cur.budget, surface, [...next]);
    return { budget: cur.budget, collapsed: next };
  }), [surface]);
  return [current.collapsed, toggle];
}
