import { useCallback, useState } from "react";

const KEY = "budget-ctrl-collapsed-groups";

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
};

// Which category groups are collapsed on one screen ("dashboard",
// "reports"). It's how you like to look at things, not part of the budget,
// so it's kept on this computer and never makes an undo step.
export function useCollapsed(surface) {
  const [collapsed, setCollapsed] = useState(() => new Set(read()[surface] || []));
  const toggle = useCallback((group) => setCollapsed((cur) => {
    const next = new Set(cur);
    if (next.has(group)) next.delete(group); else next.add(group);
    try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [surface]: [...next] })); } catch { /* kept for this session only */ }
    return next;
  }), [surface]);
  return [collapsed, toggle];
}
