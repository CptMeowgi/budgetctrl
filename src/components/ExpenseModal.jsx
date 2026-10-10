import { useState } from "react";
import { parseAmount } from "../lib/importer.js";
import { cleanSplit, isSplit, remainder } from "../lib/splits.js";
import { currencyCode, fmt } from "../money.js";
import { SPACE, TYPE, useThemed } from "../theme.js";
import { CategoryPicker } from "./FormModal.jsx";
import { Modal } from "./Modal.jsx";
import { t } from "../i18n.js";

const blankPart = () => ({ category: "", amount: "" });

// Add or edit an expense. "Split across categories" turns the one category
// into parts - a supermarket receipt that is part food, part household - that
// must add up to the amount before it will save.
export function ExpenseModal({ editing, categories, defaultDate, onClose, onSave }) {
  const { theme, s } = useThemed();
  const [name, setName] = useState(editing?.name || "");
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [category, setCategory] = useState(editing?.category || "");
  const [date, setDate] = useState(editing?.date || defaultDate);
  const [note, setNote] = useState(editing?.note || "");
  const [splitting, setSplitting] = useState(isSplit(editing));
  const [parts, setParts] = useState(isSplit(editing)
    ? editing.splits.map((p) => ({ category: p.category, amount: String(p.amount) }))
    : [{ category: editing?.category || "", amount: "" }, blankPart()]);

  const total = parseAmount(amount);
  const numericParts = parts.map((p) => ({ category: p.category, amount: parseAmount(p.amount) || 0 }));
  const left = total != null ? remainder(total, numericParts) : null;
  const split = splitting && total != null ? cleanSplit(total, numericParts) : null;
  // What is left to assign, in words - shown under the parts and on the button.
  const leftText = left == null || Math.abs(left) < 0.005 ? ""
    : left > 0 ? t("{amount} left to assign", { amount: fmt(left) }) : t("{amount} too much", { amount: fmt(-left) });
  const valid = !!name.trim() && total != null && total > 0 && !!date && (!splitting || (split && !split.error));

  const setPart = (i, patch) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const startSplit = () => {
    // The first part starts as the whole amount in the current category, so
    // splitting off one item is a matter of typing its price.
    setParts([{ category, amount: total != null ? String(total) : "" }, blankPart()]);
    setSplitting(true);
  };
  const stopSplit = () => {
    const biggest = [...numericParts].sort((a, b) => b.amount - a.amount)[0];
    if (biggest?.category) setCategory(biggest.category);
    setSplitting(false);
  };
  // Typing a part's amount takes it off the first part, which absorbs the
  // difference - the usual way to peel items off a receipt.
  const setPartAmount = (i, value) => setParts((ps) => {
    const next = ps.map((p, j) => (j === i ? { ...p, amount: value } : p));
    if (i === 0 || total == null) return next;
    const others = next.slice(1).reduce((a, p) => a + (parseAmount(p.amount) || 0), 0);
    const first = Math.round((total - others) * 100) / 100;
    return first >= 0 ? next.map((p, j) => (j === 0 ? { ...p, amount: String(first) } : p)) : next;
  });

  const submit = () => {
    if (!valid) return;
    const out = { name: name.trim(), amount: Math.round(total * 100) / 100, date, note: note.trim() || undefined };
    if (splitting && split.splits) { out.category = split.category; out.splits = split.splits; }
    else out.category = splitting ? split.category : category;
    onSave(out);
  };

  const label = { fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 };
  return (
    <Modal title={editing ? t("Edit Expense") : t("Add Expense")} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "20px 0" }}>
        <div>
          <label style={label}>{t("Name")}</label>
          <input autoFocus value={name} placeholder={t("e.g. Groceries")} onChange={(e) => setName(e.target.value)} style={s.input} />
        </div>
        <div>
          <label style={label}>{t("Amount ({currency})", { currency: currencyCode() })}</label>
          <input inputMode="decimal" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value)} style={s.input} />
        </div>
        {!splitting ? (
          <div>
            <label style={label}>{t("Category")}</label>
            <CategoryPicker value={category} onChange={setCategory} categories={categories} />
            <button style={{ ...s.linkBtn, padding: 0, marginTop: 6, ...TYPE.finePrint }} onClick={startSplit}>{t("Split across categories")}</button>
          </div>
        ) : (
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={label}>{t("Split across categories")}</label>
            {parts.map((p, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px 28px", gap: SPACE.sm, alignItems: "center", marginBottom: SPACE.xs }}>
                <CategoryPicker value={p.category} onChange={(v) => setPart(i, { category: v })} categories={categories} />
                <input inputMode="decimal" value={p.amount} placeholder="0" aria-label={t("Part {n} amount", { n: i + 1 })}
                  onChange={(e) => setPartAmount(i, e.target.value)} style={{ ...s.input, textAlign: "right" }} />
                {parts.length > 2
                  ? <button style={s.delBtn} title={t("Remove this part")} onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}>✕</button>
                  : <span />}
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: SPACE.xs }}>
              <div style={{ display: "flex", gap: SPACE.md }}>
                <button style={{ ...s.linkBtn, padding: 0, ...TYPE.finePrint }} onClick={() => setParts((ps) => [...ps, blankPart()])}>{t("+ Add part")}</button>
                <button style={{ ...s.linkBtn, padding: 0, ...TYPE.finePrint }} onClick={stopSplit}>{t("Don't split")}</button>
              </div>
              <span style={{ ...TYPE.finePrint, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                             color: left == null ? theme.textFaint : Math.abs(left) < 0.005 ? theme.success : theme.warning }}>
                {left == null ? t("Enter the amount first")
                  : Math.abs(left) < 0.005 ? t("Adds up")
                  : leftText}
              </span>
            </div>
          </div>
        )}
        <div>
          <label style={label}>{t("Date")}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={s.input} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={label}>{t("Note")}</label>
          <textarea rows={2} value={note} placeholder={t("Optional — reference, who, why")} onChange={(e) => setNote(e.target.value)}
            style={{ ...s.input, resize: "vertical", minHeight: 44, lineHeight: 1.4 }} />
        </div>
      </div>
      <button style={{ ...s.saveBtn, opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "not-allowed" }} disabled={!valid} onClick={submit}>
        {valid ? t("Save") : splitting && split?.error && leftText ? t("Parts don't add up: {detail}", { detail: leftText }) : t("Fill in name and a positive amount")}
      </button>
    </Modal>
  );
}
