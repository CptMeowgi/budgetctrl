import { useState } from "react";
import { findCategory, UNCATEGORIZED } from "../model.js";
import { ELEVATION, FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";

export function StatCard({ label, value, accent, sub, icon }) {
  const { theme, s } = useThemed();
  return (
    <div style={{ ...s.statCard, borderTop: `3px solid ${accent}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.8px", color: theme.textFaint, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 20, opacity: 0.3 }}>{icon}</div>
      </div>
      <div style={{ ...TYPE.lead, fontWeight: 600, color: accent, fontFamily: FONT, fontVariantNumeric: "tabular-nums", margin: "12px 0 4px" }}>{value}</div>
      {sub && <div style={{ ...TYPE.finePrint, lineHeight: 1.4, color: theme.textFaint }}>{sub}</div>}
    </div>
  );
}

export function TableHeader({ columns, sorts, onSort }) {
  const { theme, s } = useThemed();
  const showPriority = (sorts?.length || 0) > 1;
  return (
    <div style={s.tableHeader}>
      {columns.map((col, i) => {
        const isSortable = col.sortKey && onSort;
        const idx = sorts ? sorts.findIndex((sr) => sr.col === col.sortKey) : -1;
        const active = idx !== -1;
        const dir = active ? sorts[idx].dir : null;
        const arrow = active ? (dir === "asc" ? " ↑" : " ↓") : "";
        return (
          <div key={i} style={{
            flex: col.flex,
            textAlign: col.align || "left",
            cursor: isSortable ? "pointer" : "default",
            userSelect: "none",
          }} onClick={isSortable ? (e) => onSort(col.sortKey, e.shiftKey) : undefined}
             title={isSortable ? "Click to sort · Shift+Click to add" : undefined}>
            {col.label}{arrow}
            {active && showPriority && (
              <sup style={{ fontSize: 8, marginLeft: 2, color: theme.textMuted }}>{idx + 1}</sup>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange }) {
  const { theme } = useThemed();
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 40, height: 22, borderRadius: 11, border: "none", padding: 0,
        cursor: "pointer", flexShrink: 0, position: "relative",
        background: checked ? theme.accent : theme.border,
        transition: "background .15s",
      }}
    >
      <span style={{
        position: "absolute", top: 3, left: checked ? 21 : 3,
        width: 16, height: 16, borderRadius: "50%", background: "#fff",
        transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
      }} />
    </button>
  );
}

export function SettingRow({ label, hint, children }) {
  const { theme } = useThemed();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: theme.text }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 3 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function Toast({ message }) {
  const { theme } = useThemed();
  if (!message) return null;
  return (
    <div role="status" style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 200,
      background: theme.text, color: theme.surface, borderRadius: RADIUS.pill, padding: "10px 18px",
      ...TYPE.caption, fontWeight: 600, boxShadow: ELEVATION, pointerEvents: "none",
    }}>{message}</div>
  );
}

export function InfoHint({ text }) {
  const { theme } = useThemed();
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ width: 16, height: 16, borderRadius: "50%", border: `1px solid ${theme.textFaint}`,
                 background: "transparent", color: theme.textFaint, fontSize: 10, lineHeight: 1,
                 cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>?</button>
      {open && (
        <span style={{ position: "absolute", top: 22, left: 0, zIndex: 20, width: 260,
                       background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10,
                       padding: "10px 12px", fontSize: 12, color: theme.textMuted,
                       boxShadow: theme.shadowCard, lineHeight: 1.5, fontWeight: 400,
                       textTransform: "none", letterSpacing: 0 }}>{text}</span>
      )}
    </span>
  );
}

export function CategoryPill({ categoryName, categories, fallback }) {
  const { s } = useThemed();
  const cat = findCategory(categories, categoryName) || fallback || UNCATEGORIZED;
  return (
    <span style={{ ...s.catPill, background: `${cat.color}15`, color: cat.color }}>
      <span style={{ ...s.catDot, background: `${cat.color}25` }}>{cat.icon}</span>
      {cat.name}
    </span>
  );
}

// A number that edits in place. Reads as plain text until hovered or focused,
// so the table stays legible but the value is obviously reachable.
export function InlineNumber({ value, onChange, title }) {
  const { theme } = useThemed();
  return (
    <input
      type="number"
      className="inline-edit"
      title={title}
      value={value || ""}
      placeholder="0"
      onChange={(e) => onChange(+e.target.value || 0)}
      style={{
        width: "100%", textAlign: "right", background: "transparent",
        borderRadius: RADIUS.sm, padding: `${SPACE.xxs}px ${SPACE.xs}px`,
        color: theme.text, ...TYPE.caption, fontFamily: FONT,
        fontVariantNumeric: "tabular-nums", outline: "none", boxSizing: "border-box",
      }}
    />
  );
}

export function GoalProgress({ saved, target }) {
  const { theme } = useThemed();
  const pct = target > 0 ? Math.max(0, Math.min(100, (saved / target) * 100)) : 0;
  const reached = saved >= target;
  return (
    <div style={{ height: 8, borderRadius: RADIUS.pill, background: theme.border, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, borderRadius: RADIUS.pill,
                    background: reached ? theme.success : theme.accent, transition: "width .3s" }} />
    </div>
  );
}
