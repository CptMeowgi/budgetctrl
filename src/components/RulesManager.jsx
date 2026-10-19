import { uid } from "../model.js";
import { amountProblem, moveRule, orderedRules } from "../lib/rules.js";
import { SPACE, TYPE, useThemed } from "../theme.js";
import { Modal } from "./Modal.jsx";
import { t } from "../i18n.js";
import { catName } from "../text.js";

// Import rules, editable in place. Each change saves at once (and Ctrl+Z
// undoes it), like every other edit in the app. They are checked from the
// top, so the order is part of the rule.
export function RulesManager({ data, onChange, onClose }) {
  const { theme, s } = useThemed();
  const rules = orderedRules(data);
  const spend = (data.categories || []).map((c) => c.name);
  const credit = (data.creditCategories || []).map((c) => c.name);
  const update = (id, patch) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id) => onChange(rules.filter((r) => r.id !== id));
  const small = { ...s.input, minHeight: 34, padding: "5px 10px", ...TYPE.caption };
  const label = { ...TYPE.finePrint, fontWeight: 600, color: theme.textFaint, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 3, display: "block" };
  const arrow = { ...s.delBtn, opacity: 1 };

  const setAmount = (r, patch) => {
    const amount = { op: "under", value: null, ...(r.amount || {}), ...patch };
    update(r.id, { amount: amount.op === "any" ? undefined : amount });
  };

  return (
    <Modal title={t("Import rules")} onClose={onClose} width={760}>
      <div style={{ ...TYPE.caption, color: theme.textMuted, lineHeight: 1.5, padding: `${SPACE.sm}px 0 ${SPACE.md}px` }}>
        {t("A statement import names and files each new transaction by the first rule here that fits it, checked from the top. Case and accents don't matter. Tick {always} while reviewing an import to add one.",
          { always: <strong key="a">{t("Always")}</strong> })}
      </div>
      {/* A new rule is usually an exception to one already here, so it starts at the top. */}
      <button style={{ ...s.linkBtn, padding: 0, marginBottom: SPACE.sm }} onClick={() => onChange([{ id: uid(), match: "" }, ...rules])}>{t("+ Add rule")}</button>
      {rules.length === 0 ? (
        <div style={s.emptySmall}>{t("No rules yet.")}</div>
      ) : rules.map((r, i) => (
        <div key={r.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 12, padding: SPACE.sm, marginBottom: SPACE.sm }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1.2fr", gap: SPACE.sm, alignItems: "end" }}>
            <label>
              <span style={label}>{t("When it contains")}</span>
              <input value={r.match} placeholder={t("e.g. biedronka")} onChange={(e) => update(r.id, { match: e.target.value })} style={small} />
            </label>
            <label>
              <span style={label}>{t("But not")}</span>
              <input value={r.exclude || ""} placeholder={t("Optional")} onChange={(e) => update(r.id, { exclude: e.target.value || undefined })} style={small} />
            </label>
            <div>
              <span style={label}>{t("Amount")}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <select value={r.amount?.op || "any"} aria-label={t("Amount")} onChange={(e) => setAmount(r, { op: e.target.value })} style={{ ...small, flex: 1 }}>
                  <option value="any">{t("Any amount")}</option>
                  <option value="under">{t("Under")}</option>
                  <option value="over">{t("Over")}</option>
                  <option value="equal">{t("Exactly")}</option>
                </select>
                {r.amount && (
                  <input inputMode="decimal" aria-label={t("Amount")} value={r.amount.value ?? ""} placeholder="0"
                    aria-invalid={amountProblem(r)} title={amountProblem(r) ? t("Not a number: this rule won't apply until it is.") : undefined}
                    onChange={(e) => setAmount(r, { value: e.target.value === "" ? null : e.target.value })}
                    style={{ ...small, width: 90, textAlign: "right", ...(amountProblem(r) ? { borderColor: theme.danger, color: theme.danger } : null) }} />
                )}
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr auto", gap: SPACE.sm, alignItems: "end", marginTop: SPACE.xs }}>
            <label>
              <span style={label}>{t("Call it")}</span>
              <input value={r.rename || ""} placeholder={t("Keep the bank's name")} onChange={(e) => update(r.id, { rename: e.target.value || undefined })} style={small} />
            </label>
            <label>
              <span style={label}>{t("File under")}</span>
              <select value={r.category || ""} onChange={(e) => update(r.id, { category: e.target.value || undefined })} style={small}>
                <option value="">{t("Don't change")}</option>
                <optgroup label={t("Spending")}>{spend.map((c) => <option key={`s-${c}`} value={c}>{catName(c)}</option>)}</optgroup>
                <optgroup label={t("Money in")}>{credit.filter((c) => !spend.includes(c)).map((c) => <option key={`c-${c}`} value={c}>{catName(c)}</option>)}</optgroup>
              </select>
            </label>
            <div style={{ display: "flex", gap: 2 }}>
              <button style={{ ...arrow, opacity: i === 0 ? 0.3 : 1 }} disabled={i === 0} title={t("Move up")} onClick={() => onChange(moveRule(rules, r.id, -1))}>↑</button>
              <button style={{ ...arrow, opacity: i === rules.length - 1 ? 0.3 : 1 }} disabled={i === rules.length - 1} title={t("Move down")} onClick={() => onChange(moveRule(rules, r.id, 1))}>↓</button>
              <button style={s.delBtn} title={t("Delete rule")} onClick={() => remove(r.id)}>✕</button>
            </div>
          </div>
        </div>
      ))}
    </Modal>
  );
}
