import { useMemo } from "react";
import { periodLabel } from "../lib/periods.js";
import { isEmptyQuery, search } from "../lib/search.js";
import { CREDIT_UNCATEGORIZED } from "../model.js";
import { fmt } from "../money.js";
import { FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { CategoryPill } from "./controls.jsx";
import { Modal } from "./Modal.jsx";
import { fmtDate, t, tk, tn } from "../i18n.js";
import { catName } from "../text.js";

const KINDS = [
  { id: "expense", label: tk("Expenses") },
  { id: "recurring", label: tk("Recurring") },
  { id: "upcoming", label: tk("Payments") },
  { id: "credit", label: tk("Credits") },
];
const KIND_LABEL = { expense: tk("Expense"), recurring: tk("Recurring bill"), upcoming: tk("Payment"), credit: tk("Credit") };
// Enough to scan; past this the answer is to narrow the search.
const SHOWN = 200;

function dayLabel(iso) {
  return iso ? fmtDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "";
}

export function SearchModal({ data, query, onQueryChange, onClose, onOpen }) {
  const { theme, s } = useThemed();
  const q = query;
  const set = (patch) => onQueryChange({ ...q, ...patch });
  const result = useMemo(() => (isEmptyQuery(q) ? null : search(data, q, catName)), [data, q]);
  const categories = [...new Set([
    ...(data.categories || []).map((c) => c.name),
    ...(data.creditCategories || []).map((c) => c.name),
  ])].sort((a, b) => catName(a).localeCompare(catName(b)));
  const kinds = q.kinds || [];
  const toggleKind = (id) => set({ kinds: kinds.includes(id) ? kinds.filter((k) => k !== id) : [...kinds, id] });
  const chip = (active) => ({
    ...TYPE.finePrint, fontWeight: 600, fontFamily: FONT, cursor: "pointer", borderRadius: RADIUS.pill,
    padding: "5px 12px", border: `1px solid ${active ? theme.accent : theme.border}`,
    background: active ? `${theme.accent}18` : "transparent", color: active ? theme.accent : theme.textMuted,
  });
  const small = { ...s.input, minHeight: 34, padding: "5px 10px", width: "auto" };
  const money = { fontFamily: FONT, fontVariantNumeric: "tabular-nums" };
  const cutoffDay = data.cutoffDay || 1;

  return (
    <Modal title={t("Search everything")} onClose={onClose} width={780}>
      <div style={{ paddingTop: SPACE.sm }}>
        <input autoFocus value={q.text || ""} placeholder={t("Name, category, note or amount - every month")}
          aria-label={t("Search")}
          onChange={(e) => set({ text: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter" && result?.results[0]) onOpen(result.results[0]); }}
          style={{ ...s.input, fontSize: 15 }} />

        <div style={{ display: "flex", flexWrap: "wrap", gap: SPACE.xs, marginTop: SPACE.sm, alignItems: "center" }}>
          <button style={chip(kinds.length === 0)} onClick={() => set({ kinds: [] })}>{t("All")}</button>
          {KINDS.map((k) => <button key={k.id} style={chip(kinds.includes(k.id))} onClick={() => toggleKind(k.id)}>{t(k.label)}</button>)}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: SPACE.sm, marginTop: SPACE.sm, alignItems: "center", ...TYPE.finePrint, color: theme.textMuted }}>
          <select aria-label={t("Category")} value={q.category || ""} onChange={(e) => set({ category: e.target.value })} style={{ ...small, minWidth: 160 }}>
            <option value="">{t("Any category")}</option>
            {categories.map((c) => <option key={c} value={c}>{catName(c)}</option>)}
          </select>
          <span>{t("from")}</span>
          <input type="date" aria-label={t("From")} value={q.from || ""} onChange={(e) => set({ from: e.target.value })} style={small} />
          <span>{t("to")}</span>
          <input type="date" aria-label={t("To")} value={q.to || ""} onChange={(e) => set({ to: e.target.value })} style={small} />
          <span>{t("amount")}</span>
          <input inputMode="decimal" aria-label={t("Minimum amount")} placeholder={t("min")} value={q.min ?? ""}
            onChange={(e) => set({ min: e.target.value.replace(",", ".") })} style={{ ...small, width: 80 }} />
          <input inputMode="decimal" aria-label={t("Maximum amount")} placeholder={t("max")} value={q.max ?? ""}
            onChange={(e) => set({ max: e.target.value.replace(",", ".") })} style={{ ...small, width: 80 }} />
          {!isEmptyQuery(q) && (
            <button style={{ ...s.linkBtn, padding: 0, ...TYPE.finePrint }} onClick={() => onQueryChange({ text: "", kinds: [] })}>{t("Clear")}</button>
          )}
        </div>

        {!result ? (
          <div style={{ ...s.emptySmall, padding: `${SPACE.xl}px 0` }}>{t("Type a name, category, note or amount, or pick a filter. Searches every month, not just this one.")}</div>
        ) : (
          <>
            <div style={{ ...TYPE.caption, color: theme.textMuted, margin: `${SPACE.md}px 0 ${SPACE.xs}px`, ...money }}>
              {result.count === 0 ? t("Nothing matches.") : (
                <>
                  {tn(result.count, "{n} result", "{n} results")}
                  {result.spent > 0 && <> · {t("spent {amount}", { amount: <strong key="s" style={{ color: theme.danger }}>{fmt(result.spent)}</strong> })}</>}
                  {result.received > 0 && <> · {t("received {amount}", { amount: <strong key="r" style={{ color: theme.success }}>{fmt(result.received)}</strong> })}</>}
                </>
              )}
            </div>
            {result.results.slice(0, SHOWN).map((r) => {
              const credit = r.kind === "credit";
              return (
                <button key={`${r.periodKey}-${r.kind}-${r.entry.id}`} onClick={() => onOpen(r)}
                  title={t("Open to edit")}
                  style={{ all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "center", gap: SPACE.md,
                           padding: `${SPACE.sm}px ${SPACE.xs}px`, borderBottom: `1px solid ${theme.border}`, cursor: "pointer" }}>
                  <div style={{ width: 92, flexShrink: 0, ...TYPE.finePrint, color: theme.textMuted, ...money }}>{dayLabel(r.date)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...TYPE.caption, fontWeight: 600, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.entry.name}</div>
                    <div style={{ ...TYPE.finePrint, color: theme.textFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t(KIND_LABEL[r.kind])} · {periodLabel(r.periodKey, cutoffDay).primary}{r.entry.note ? ` · ${r.entry.note}` : ""}
                    </div>
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    <CategoryPill categoryName={r.category}
                      categories={credit ? data.creditCategories || [] : data.categories || []}
                      fallback={credit ? CREDIT_UNCATEGORIZED : undefined} />
                  </div>
                  <div style={{ width: 110, flexShrink: 0, textAlign: "right", fontWeight: 700, ...money, color: credit ? theme.success : theme.danger }}>
                    {credit ? "+" : ""}{fmt(r.amount)}
                  </div>
                </button>
              );
            })}
            {result.count > SHOWN && (
              <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: SPACE.sm }}>
                {t("Showing the newest {shown}. Narrow the search to see the rest; the totals above cover all {count}.", { shown: SHOWN, count: result.count })}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
