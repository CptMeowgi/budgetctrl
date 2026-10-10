import { uid } from "../model.js";
import { SPACE, TYPE, useThemed } from "../theme.js";
import { Modal } from "./Modal.jsx";
import { t } from "../i18n.js";
import { catName } from "../text.js";

// Import rules, editable in place. Each change saves at once (and Ctrl+Z
// undoes it), like every other edit in the app.
export function RulesManager({ data, onChange, onClose }) {
  const { theme, s } = useThemed();
  const rules = data.importRules || [];
  const spend = (data.categories || []).map((c) => c.name);
  const credit = (data.creditCategories || []).map((c) => c.name);
  const update = (id, patch) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id) => onChange(rules.filter((r) => r.id !== id));
  const small = { ...s.input, minHeight: 34, padding: "5px 10px", ...TYPE.caption };

  return (
    <Modal title={t("Import rules")} onClose={onClose} width={720}>
      <div style={{ ...TYPE.caption, color: theme.textMuted, lineHeight: 1.5, padding: `${SPACE.sm}px 0 ${SPACE.md}px` }}>
        {t("When a bank description contains the text on the left, a statement import names and files it for you. Case and accents don't matter. If several rules match, the longest text wins. Tick {always} while reviewing an import to add one.",
          { always: <strong key="a">{t("Always")}</strong> })}
      </div>
      {rules.length === 0 ? (
        <div style={s.emptySmall}>{t("No rules yet.")}</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1fr 28px", gap: SPACE.sm, ...TYPE.finePrint, fontWeight: 600,
                        color: theme.textFaint, textTransform: "uppercase", letterSpacing: "0.6px", paddingBottom: SPACE.xs }}>
            <span>{t("When it contains")}</span><span>{t("Call it")}</span><span>{t("File under")}</span><span />
          </div>
          {rules.map((r) => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 1fr 28px", gap: SPACE.sm, alignItems: "center", marginBottom: SPACE.xs }}>
              <input value={r.match} placeholder={t("e.g. biedronka")} aria-label={t("When it contains")}
                onChange={(e) => update(r.id, { match: e.target.value })} style={small} />
              <input value={r.rename || ""} placeholder={t("Keep the bank's name")} aria-label={t("Call it")}
                onChange={(e) => update(r.id, { rename: e.target.value || undefined })} style={small} />
              <select value={r.category || ""} aria-label={t("File under")} onChange={(e) => update(r.id, { category: e.target.value || undefined })} style={small}>
                <option value="">{t("Don't change")}</option>
                <optgroup label={t("Spending")}>{spend.map((c) => <option key={`s-${c}`} value={c}>{catName(c)}</option>)}</optgroup>
                <optgroup label={t("Money in")}>{credit.filter((c) => !spend.includes(c)).map((c) => <option key={`c-${c}`} value={c}>{catName(c)}</option>)}</optgroup>
              </select>
              <button style={s.delBtn} title={t("Delete rule")} onClick={() => remove(r.id)}>✕</button>
            </div>
          ))}
        </>
      )}
      <button style={{ ...s.linkBtn, marginTop: SPACE.sm }} onClick={() => onChange([...rules, { id: uid(), match: "" }])}>{t("+ Add rule")}</button>
    </Modal>
  );
}
