import { useState } from "react";
import { fmt } from "../money.js";
import { FONT, SPACE, TYPE, useThemed } from "../theme.js";

export function CategoryBudgets({ categories, spent, average, envelopeOf, onSetBudget, onStartFresh }) {
  const { theme, s } = useThemed();
  const [editing, setEditing] = useState(null);
  const [draftCap, setDraftCap] = useState("");
  const [draftRollover, setDraftRollover] = useState(false);

  const startEdit = (c) => {
    setEditing(c.name);
    setDraftCap(c.cap != null ? String(c.cap) : "");
    setDraftRollover(!!c.rollover);
  };
  const commitEdit = () => {
    const n = parseFloat(String(draftCap).replace(",", "."));
    onSetBudget(editing, isFinite(n) && n > 0 ? n : null, draftRollover);
    setEditing(null);
  };
  const cancelEdit = () => setEditing(null);

  const rows = categories
    .filter((c) => c.name !== "Uncategorized")
    .map((c) => {
      const sp = spent.get(c.name) || 0;
      // What this period can spend: the budget, plus or minus whatever rolled
      // in. An envelope already empty on arrival is over budget at once.
      const env = envelopeOf(c, sp);
      const pct = env.available == null ? null
        : env.available > 0 ? (sp / env.available) * 100
        : (sp > 0 || env.available < 0 ? Infinity : 0);
      return { ...c, sp, pct, env };
    })
    .sort((a, b) => {
      if (a.pct == null && b.pct == null) return a.name.localeCompare(b.name);
      if (a.pct == null) return 1;
      if (b.pct == null) return -1;
      return b.pct - a.pct;
    });

  if (rows.length === 0) {
    return <div style={s.empty}>No categories yet. Add an expense to start tracking.</div>;
  }

  return (
    <div>
      {rows.map((r) => {
        const isEditing = editing === r.name;
        const avg = average(r.name);
        const barColor = r.pct == null ? theme.border
          : r.pct > 100 ? theme.danger
          : r.pct > 80 ? theme.warning
          : theme.accent;
        return (
          <div key={r.name} style={{ padding: "12px 0", borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: r.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{r.icon}</div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!isEditing && (
                  <span style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontSize: 12, color: theme.textMuted }}>
                    {fmt(r.sp)} / {r.env.available != null ? fmt(r.env.available) : "—"}
                  </span>
                )}
                {!isEditing && (
                  <button style={s.editBtn} onClick={() => startEdit(r)}>{r.env.cap != null ? "✎" : "+"}</button>
                )}
                {isEditing && (
                  <>
                    <input type="text" inputMode="decimal" autoFocus
                      value={draftCap}
                      placeholder="Budget"
                      aria-label={`Budget for ${r.name}`}
                      onChange={(e) => setDraftCap(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                      style={{ width: 80, ...s.input, padding: "6px 10px", fontSize: 12 }} />
                    <button style={s.editBtn} onClick={commitEdit}>✓</button>
                    <button style={s.delBtn} onClick={cancelEdit}>✕</button>
                  </>
                )}
              </div>
            </div>
            {isEditing && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: SPACE.sm, margin: "2px 0 8px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, ...TYPE.finePrint, color: theme.textMuted, cursor: "pointer" }}
                  title="Unspent budget carries into next month. Overspending carries too, as a deficit.">
                  <input type="checkbox" checked={draftRollover} onChange={(e) => setDraftRollover(e.target.checked)} />
                  Roll over what's left into next month
                </label>
                {r.rollover && r.env.carry !== 0 && (
                  <button style={{ ...s.linkBtn, ...TYPE.finePrint }} onClick={() => { onStartFresh(r.name); setEditing(null); }}
                    title="Forget the carried balance and count from this month">Start fresh</button>
                )}
              </div>
            )}
            {r.env.available != null && (
              <div style={{ height: 6, background: theme.bg, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, r.pct)}%`, height: "100%", background: barColor, transition: "width .3s" }} />
              </div>
            )}
            {(r.rollover || avg != null) && (
              <div style={{ fontSize: 11, color: theme.textFaint, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                {r.rollover && (
                  <span title={`Budget ${fmt(r.env.cap)} this month, ${r.env.carry >= 0 ? "plus" : "less"} what carried over`}
                    style={{ color: r.env.carry < 0 ? theme.danger : r.env.carry > 0 ? theme.accent : theme.textFaint }}>
                    ↻ {r.env.carry > 0 ? `${fmt(r.env.carry)} carried in`
                      : r.env.carry < 0 ? `${fmt(-r.env.carry)} overspent before`
                      : "Rolls over"}
                  </span>
                )}
                {r.rollover && avg != null && " · "}
                {avg != null && `avg of past months: ${fmt(avg)}`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
