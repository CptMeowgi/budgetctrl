import { createContext, useCallback, useContext, useState } from "react";

const KEY = "budget-ctrl-collapsed-groups";

// The budget that is open: "household", or the person whose own budget it is.
// App provides it, so collapsed groups are remembered per budget without every
// screen in between passing it down.
export const OpenBudgetContext = createContext("household");

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
};

// The household's are kept as they always were, under the screen's name; an
// own budget's under "<person id>:<screen>".
const memoryKey = (budget, surface) => (!budget || budget === "household" ? surface : `${budget}:${surface}`);

// Which category groups are collapsed on one screen ("dashboard",
// "reports"). It's how you like to look at things, not part of the budget,
// so it's kept on this computer and never makes an undo step.
export function useCollapsed(surface) {
  const key = memoryKey(useContext(OpenBudgetContext), surface);
  const [state, setState] = useState(() => ({ key, collapsed: new Set(read()[key] || []) }));
  // Another budget opened: its own memory, read as the screen draws.
  let current = state;
  if (state.key !== key) {
    current = { key, collapsed: new Set(read()[key] || []) };
    setState(current);
  }
  const toggle = useCallback((group) => setState((cur) => {
    const next = new Set(cur.collapsed);
    if (next.has(group)) next.delete(group); else next.add(group);
    try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [cur.key]: [...next] })); } catch { /* kept for this session only */ }
    return { key: cur.key, collapsed: next };
  }), []);
  return [current.collapsed, toggle];
}
