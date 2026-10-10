import { useState } from "react";
import { countUsage, deleteCategory, isFallback, renameCategory, restyleCategory } from "../lib/categories.js";
import { ensureCategory, ensureCreditCategory, PICKER_COLORS, PICKER_ICONS } from "../model.js";
import { FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { Modal } from "./Modal.jsx";

function CategoryRow({ cat, kind, data, onRename, onRestyle, onDelete }) {
  const { theme, s } = useThemed();
  const [draft, setDraft] = useState(cat.name);
  const [styling, setStyling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const locked = isFallback(kind, cat.name);
  const usage = countUsage(data, kind, cat.name);
  const listKey = kind === "spend" ? "categories" : "creditCategories";
  const others = (data[listKey] || []).filter((c) => c.name !== cat.name);

  // No prop-to-state sync needed: rows are keyed by name, so a rename that
  // lands remounts the row with a fresh draft. Only a rename that does NOT land
  // (a declined merge, or an error) has to put the old name back.
  const commit = () => {
    const next = draft.trim();
    if (!next || next === cat.name) { setDraft(cat.name); return; }
    if (!onRename(cat.name, next)) setDraft(cat.name);
  };

  const usageText = usage.entries || usage.templates
    ? `${usage.entries} entr${usage.entries === 1 ? "y" : "ies"}${usage.templates ? ` · ${usage.templates} recurring` : ""}`
    : "unused";

  return (
    <div style={{ borderBottom: `1px solid ${theme.border}`, padding: `${SPACE.xs}px 0` }}>
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
        <button
          onClick={() => !locked && setStyling((v) => !v)}
          title={locked ? undefined : "Change colour and icon"}
          style={{ ...s.catDot, width: 32, height: 32, border: "none", cursor: locked ? "default" : "pointer",
                   background: `${cat.color}25`, color: cat.color, fontSize: 15, flexShrink: 0 }}
        >{cat.icon}</button>
        {locked ? (
          <div style={{ flex: 1, ...TYPE.caption, color: theme.text }}>
            {cat.name}
            <span style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 8 }}>default — always kept</span>
          </div>
        ) : (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") { e.stopPropagation(); setDraft(cat.name); e.currentTarget.blur(); }
            }}
            className="inline-edit"
            style={{ flex: 1, background: "transparent", borderRadius: RADIUS.sm, padding: `${SPACE.xxs}px ${SPACE.xs}px`,
                     color: theme.text, ...TYPE.caption, fontFamily: FONT, outline: "none", minWidth: 0 }}
          />
        )}
        <span style={{ ...TYPE.finePrint, color: theme.textFaint, whiteSpace: "nowrap" }}>{usageText}</span>
        {!locked && (
          <button style={s.delBtn} title="Delete category" onClick={() => setDeleting((v) => !v)}>✕</button>
        )}
      </div>

      {styling && !locked && (
        <div style={{ padding: `${SPACE.xs}px 0 ${SPACE.xs}px 44px`, display: "flex", flexDirection: "column", gap: SPACE.xs }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PICKER_COLORS.map((c) => (
              <button key={c} onClick={() => onRestyle(cat.name, { color: c })} title={c}
                style={{ width: 22, height: 22, borderRadius: "50%", background: c, cursor: "pointer", padding: 0,
                         border: c === cat.color ? `2px solid ${theme.text}` : "2px solid transparent" }} />
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {PICKER_ICONS.map((ic) => (
              <button key={ic} onClick={() => onRestyle(cat.name, { icon: ic })}
                style={{ width: 30, height: 30, borderRadius: RADIUS.sm, cursor: "pointer", fontSize: 15, padding: 0,
                         background: ic === cat.icon ? theme.accentSoft : "transparent",
                         border: `1px solid ${ic === cat.icon ? theme.accent : theme.border}` }}>{ic}</button>
            ))}
          </div>
        </div>
      )}

      {deleting && !locked && (
        <div style={{ padding: `${SPACE.xs}px 0 ${SPACE.xs}px 44px`, display: "flex", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap" }}>
          {usage.entries || usage.templates ? (
            <>
              <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textMuted }}>Move its {usageText} to</span>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ ...s.input, width: 180, minHeight: 32, padding: "4px 8px" }}>
                <option value="">{kind === "spend" ? "Uncategorized" : "Other"}</option>
                {others.filter((c) => !isFallback(kind, c.name)).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </>
          ) : (
            <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textMuted }}>Nothing uses this category.</span>
          )}
          <button style={{ ...s.linkBtn, padding: 0, color: theme.danger }} onClick={() => onDelete(cat.name, moveTo)}>Delete</button>
          <button style={{ ...s.linkBtn, padding: 0, color: theme.textMuted }} onClick={() => setDeleting(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// Categories used to be created by typing a name into an entry form, with no
// way to rename, restyle or remove one afterwards - so a typo was permanent and
// every report inherited it. The data transforms live in lib/categories.js
// where they are unit-tested; this is only the surface over them.
export function CategoryManager({ data, onClose, onChange }) {
  const { theme, s } = useThemed();
  const [kind, setKind] = useState("spend");
  const [newName, setNewName] = useState("");
  const listKey = kind === "spend" ? "categories" : "creditCategories";
  const list = data[listKey] || [];

  // Fallback first, then alphabetical, so the list is stable while editing.
  const ordered = [...list].sort((a, b) =>
    (isFallback(kind, b.name) - isFallback(kind, a.name)) || a.name.localeCompare(b.name));

  // Returns whether the change was applied, so a row can restore its input.
  const run = (fn) => {
    try { onChange(fn()); return true; } catch (err) { alert(err.message); return false; }
  };

  const onRename = (from, to) => {
    const target = list.find((c) => c.name.toLowerCase() === to.toLowerCase() && c.name !== from);
    if (target && !confirm(`Merge "${from}" into "${target.name}"?\n\nEverything in "${from}" moves to "${target.name}", and "${from}" is removed.`)) return false;
    return run(() => renameCategory(data, kind, from, to));
  };

  const onAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const ensure = kind === "spend" ? ensureCategory : ensureCreditCategory;
    const { categories } = ensure(list, name);
    onChange({ ...data, [listKey]: categories });
    setNewName("");
  };

  const segBtn = (value, label) => (
    <button onClick={() => setKind(value)} style={{
      flex: 1, border: "none", cursor: "pointer", borderRadius: RADIUS.pill, padding: "8px 12px",
      ...TYPE.caption, fontWeight: kind === value ? 600 : 400, fontFamily: FONT,
      background: kind === value ? theme.surface : "transparent",
      color: kind === value ? theme.text : theme.textMuted,
      boxShadow: kind === value ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
    }}>{label}</button>
  );

  return (
    <Modal title="Categories" onClose={onClose} width={560}>
      <div style={{ display: "flex", gap: 4, background: theme.bg, borderRadius: RADIUS.pill, padding: 4, margin: `${SPACE.xs}px 0 ${SPACE.sm}px` }}>
        {segBtn("spend", "Spending")}
        {segBtn("credit", "Income sources")}
      </div>
      <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginBottom: SPACE.xs }}>
        Rename by editing a name — renaming onto an existing one merges them. Click a badge to change its colour and icon.
      </div>
      <div style={{ maxHeight: "52vh", overflowY: "auto", paddingRight: 4 }}>
        {ordered.map((c) => (
          <CategoryRow key={`${kind}:${c.name}`} cat={c} kind={kind} data={data}
            onRename={onRename}
            onRestyle={(name, style) => run(() => restyleCategory(data, kind, name, style))}
            onDelete={(name, moveTo) => run(() => deleteCategory(data, kind, name, moveTo))}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: SPACE.sm, marginTop: SPACE.md }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
          placeholder={kind === "spend" ? "New spending category" : "New income source"}
          style={{ ...s.input, flex: 1 }} />
        <button style={{ ...s.addBtn, opacity: newName.trim() ? 1 : 0.5 }} disabled={!newName.trim()} onClick={onAdd}>Add</button>
      </div>
    </Modal>
  );
}
