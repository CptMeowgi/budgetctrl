import { useState } from "react";
import { catName } from "../text.js";
import { SPACE, TYPE, useThemed } from "../theme.js";
import { t, tn } from "../i18n.js";

// The bar over a list while entries are being selected: how many, file them
// all under one category, or delete them all. Each is one change, so one
// Ctrl+Z undoes it.
export function BulkBar({ count, shown, categories, onSelectAll, onSelectNone, onCategory, onDelete, onDone }) {
  const { theme, s } = useThemed();
  const [armed, setArmed] = useState(false);
  const small = { ...s.input, width: "auto", minHeight: 32, padding: "4px 10px", ...TYPE.finePrint };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: SPACE.md, flexWrap: "wrap", padding: `${SPACE.xs}px ${SPACE.sm}px`,
                  margin: `${SPACE.xs}px 0`, borderRadius: 12, background: theme.bg, ...TYPE.caption }}>
      <strong>{tn(count, "{n} selected", "{n} selected")}</strong>
      {count < shown
        ? <button style={{ ...s.linkBtn, padding: 0 }} onClick={onSelectAll}>{t("Select all {n} shown", { n: shown })}</button>
        : <button style={{ ...s.linkBtn, padding: 0 }} onClick={onSelectNone}>{t("Select none")}</button>}
      <select value="" disabled={!count} aria-label={t("File the selected entries under")} style={{ ...small, opacity: count ? 1 : 0.5 }}
        onChange={(e) => { if (e.target.value) onCategory(e.target.value); }}>
        <option value="">{t("File under…")}</option>
        {categories.map((c) => <option key={c} value={c}>{catName(c)}</option>)}
      </select>
      <button disabled={!count} onBlur={() => setArmed(false)}
        style={{ ...s.linkBtn, padding: 0, color: theme.danger, fontWeight: armed ? 700 : 600, opacity: count ? 1 : 0.5 }}
        onClick={() => { if (armed) { onDelete(); setArmed(false); } else setArmed(true); }}>
        {armed ? t("Click again to delete them") : tn(count, "Delete {n}", "Delete {n}")}
      </button>
      <button style={{ ...s.linkBtn, padding: 0, marginLeft: "auto" }} onClick={onDone}>{t("Done")}</button>
    </div>
  );
}
