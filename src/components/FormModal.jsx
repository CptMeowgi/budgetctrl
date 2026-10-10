import { useState } from "react";
import { TYPE, useThemed } from "../theme.js";
import { Modal } from "./Modal.jsx";

function CategoryPicker({ value, onChange, categories }) {
  const { s } = useThemed();
  const [open, setOpen] = useState(false);
  const suggestions = categories.filter((c) => {
    if (c.name === "Uncategorized") return false;
    if (!value) return true;
    return c.name.toLowerCase().includes(value.toLowerCase());
  });
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        placeholder="e.g. Food, Transport"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={s.input}
      />
      {open && suggestions.length > 0 && (
        <div style={s.suggestBox}>
          {suggestions.map((c) => (
            <div key={c.name} style={s.suggestItem}
              onMouseDown={(e) => { e.preventDefault(); onChange(c.name); setOpen(false); }}>
              <span style={{ ...s.catDot, background: `${c.color}25` }}>{c.icon}</span>
              <span>{c.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FormModal({ title, fields, onClose, onSave }) {
  const { theme, s } = useThemed();
  const [vals, setVals] = useState(() => {
    const init = {};
    fields.forEach((f) => { init[f.key] = f.type === "checkbox" ? !!f.defaultValue : (f.defaultValue || ""); });
    return init;
  });
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: fields.length > 3 ? "1fr 1fr" : "1fr", gap: 16, padding: "20px 0" }}>
        {fields.map((f) => (
          <div key={f.key} style={f.type === "checkbox" || f.type === "textarea" ? { gridColumn: "1 / -1" } : undefined}>
            {f.type !== "checkbox" && (
              <label style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 }}>{f.label}</label>
            )}
            {f.type === "checkbox" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "4px 0" }}>
                <input type="checkbox" checked={!!vals[f.key]}
                  onChange={(e) => setVals({ ...vals, [f.key]: e.target.checked })}
                  style={{ accentColor: theme.accent, width: 16, height: 16, cursor: "pointer" }} />
                <span>
                  <span style={{ ...TYPE.caption, color: theme.text }}>{f.label}</span>
                  {f.hint && <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, display: "block" }}>{f.hint}</span>}
                </span>
              </label>
            ) : f.type === "select" ? (
              <select value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} style={s.input}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "category" ? (
              <CategoryPicker value={vals[f.key] || ""} onChange={(v) => setVals({ ...vals, [f.key]: v })} categories={f.categories} />
            ) : f.type === "textarea" ? (
              <textarea placeholder={f.placeholder} rows={2}
                value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                style={{ ...s.input, resize: "vertical", minHeight: 44, lineHeight: 1.4 }} />
            ) : f.type === "number" ? (
              <input type="text" inputMode="decimal" placeholder={f.placeholder}
                value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                style={s.input} />
            ) : (
              <input type={f.type || "text"} placeholder={f.placeholder}
                value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                style={s.input} />
            )}
          </div>
        ))}
      </div>
      {(() => {
        const amountNum = parseFloat(String(vals.amount).replace(",", "."));
        const valid = vals.name?.trim() && !isNaN(amountNum) && amountNum > 0;
        return (
          <button
            style={{ ...s.saveBtn, opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "not-allowed" }}
            disabled={!valid}
            onClick={() => onSave({ ...vals, amount: amountNum })}
          >
            {valid ? "Save" : "Fill in name and a positive amount"}
          </button>
        );
      })()}
    </Modal>
  );
}
