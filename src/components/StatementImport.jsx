import { useState } from "react";
import { analyzeImport, applyImport, decodeBytes, findHeaderRow, guessMapping, parseCsv, sniffDelimiter, toTransactions } from "../lib/importer.js";
import { uid } from "../model.js";
import { fmt } from "../money.js";
import { SPACE, TYPE, useThemed } from "../theme.js";
import { SettingRow } from "./controls.jsx";
import { Modal } from "./Modal.jsx";
import { suggestMatch, upsertRule } from "../lib/rules.js";
import { t, tk, tn } from "../i18n.js";
import { catName } from "../text.js";

const ACTION_LABEL = { expense: tk("Expense"), credit: tk("Credit"), markPaid: tk("Marks paid"), skip: tk("Skip") };

// Bank statement import. The parsing and the double-count matching live in
// lib/importer.js where they are tested; this is the wizard over them:
// pick a file, confirm what each column is, review every row, import.
export function StatementImport({ data, onClose, onImport }) {
  const { theme, s } = useThemed();
  const [step, setStep] = useState("pick");
  const [file, setFile] = useState(null);       // { name, encoding, delimiter, rows, headerIndex }
  const [mapping, setMapping] = useState(null);
  const [splitAmounts, setSplitAmounts] = useState(false);
  const [invert, setInvert] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const { text, encoding } = decodeBytes(new Uint8Array(await f.arrayBuffer()));
      const delimiter = sniffDelimiter(text);
      const parsed = parseCsv(text, delimiter);
      if (parsed.length < 2) { setError(t("That file doesn't contain a table of transactions.")); return; }
      const headerIndex = findHeaderRow(parsed);
      const m = guessMapping(parsed[headerIndex]);
      setFile({ name: f.name, encoding, delimiter, rows: parsed, headerIndex });
      setMapping(m);
      setSplitAmounts(m.amount < 0 && (m.debit >= 0 || m.credit >= 0));
      setInvert(false);
      setError("");
      setStep("map");
    } catch {
      setError(t("Couldn't read that file. Export a CSV from your bank and try again."));
    }
  };

  const header = file ? file.rows[file.headerIndex] : [];
  const effective = mapping && (splitAmounts ? { ...mapping, amount: -1 } : { ...mapping, debit: -1, credit: -1 });
  const preview = file && effective ? toTransactions(file.rows, file.headerIndex, effective, { invert }) : null;

  const col = (key, label) => (
    <SettingRow label={label}>
      <select value={mapping[key]} onChange={(e) => setMapping({ ...mapping, [key]: +e.target.value })}
        style={{ ...s.input, width: 230, minHeight: 36, padding: "6px 10px" }}>
        <option value={-1}>{t("— none —")}</option>
        {header.map((h, i) => <option key={i} value={i}>{h || t("Column {n}", { n: i + 1 })}</option>)}
      </select>
    </SettingRow>
  );

  const toReview = () => {
    setRows(analyzeImport(preview.transactions, data));
    setStep("review");
  };

  const toggle = (id) => setRows((rs) => rs.map((r) => {
    if (r.id !== id) return r;
    if (r.include) return { ...r, include: false };
    // Ticking a row the matcher skipped means "import it anyway".
    return r.action === "skip" ? { ...r, include: true, action: r.amount < 0 ? "expense" : "credit" } : { ...r, include: true };
  }));
  // Rows that an "Always" tick will cover: same rule text, no rule of their own.
  const sameMatch = (a, b) => !b.rule && suggestMatch(a.bankName || a.name) === suggestMatch(b.bankName || b.name)
    && (b.action === "expense" || b.action === "credit") && (a.amount < 0) === (b.amount < 0);
  const setCategory = (id, category) => setRows((rs) => {
    const row = rs.find((r) => r.id === id);
    return rs.map((r) => (r.id === id || (row?.remember && sameMatch(row, r)) ? { ...r, category } : r));
  });
  // "Always": remember this payee's category as a rule, and file the other
  // rows from the same payee the same way now.
  const toggleRemember = (id) => setRows((rs) => {
    const row = rs.find((r) => r.id === id);
    const on = !row.remember;
    return rs.map((r) => {
      if (r.id === id) return { ...r, remember: on };
      if (on && sameMatch(row, r)) return { ...r, category: row.category };
      return r;
    });
  });
  const setAll = (include) => setRows((rs) => rs.map((r) =>
    include && r.action === "skip" ? r : { ...r, include: include && r.action !== "skip" }));

  const kept = rows.filter((r) => r.include);
  const tally = {
    expense: kept.filter((r) => r.action === "expense").length,
    credit: kept.filter((r) => r.action === "credit").length,
    markPaid: kept.filter((r) => r.action === "markPaid").length,
    skip: rows.length - kept.length,
  };

  const doImport = () => {
    let n = 0;
    const newId = () => `${uid()}${++n}`;
    let rules = data.importRules || [];
    let added = 0;
    for (const r of rows) {
      if (!r.include || !r.remember || (r.action !== "expense" && r.action !== "credit")) continue;
      const before = rules.length;
      rules = upsertRule(rules, { match: suggestMatch(r.bankName || r.name), category: r.category || (r.amount < 0 ? "Uncategorized" : "Other") }, newId);
      if (rules.length > before) added++;
    }
    const { data: next, counts } = applyImport({ ...data, importRules: rules }, rows, newId);
    onImport(next, { ...counts, rules: added });
  };

  const hint = { ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint };

  return (
    <Modal title={t("Import bank statement")} onClose={onClose} width={step === "review" ? 820 : 560}>
      {step === "pick" && (
        <div style={{ padding: `${SPACE.sm}px 0` }}>
          <div style={{ ...TYPE.caption, color: theme.textMuted, lineHeight: 1.5, marginBottom: SPACE.md }}>{t("Export your transactions from online banking as CSV, then choose the file. You'll check every row before anything is added.")}</div>
          <label style={{ ...s.addBtn, display: "inline-block" }}>
            {t("Choose CSV file…")}
            <input type="file" accept=".csv,.txt,text/csv" onChange={onFile} style={{ display: "none" }} />
          </label>
          {error && <div style={{ ...TYPE.caption, color: theme.danger, marginTop: SPACE.sm }}>{error}</div>}
          <div style={{ ...hint, marginTop: SPACE.md }}>{t("Payments already in your budget — recurring bills, your salary, things you entered by hand — are recognised and left unticked, so nothing is counted twice.")}</div>
        </div>
      )}

      {step === "map" && file && (
        <div>
          <div style={{ ...hint, marginBottom: SPACE.xs }}>
            {file.name} · {file.encoding === "utf-8" ? "UTF-8" : "Windows-1250"} · {t("separated by {sep}", { sep: file.delimiter === "\t" ? t("tabs") : `"${file.delimiter}"` })}
            {" · "}{tn(file.rows.length - file.headerIndex - 1, "{n} row", "{n} rows")}
          </div>
          {col("date", t("Date"))}
          {col("payee", t("Name (who was paid)"))}
          {col("title", t("Description"))}
          <SettingRow label={t("Amounts")} hint={splitAmounts ? t("Money out and money in are in separate columns.") : t("One column; spending is negative.")}>
            <select value={splitAmounts ? "split" : "single"} onChange={(e) => setSplitAmounts(e.target.value === "split")}
              style={{ ...s.input, width: 230, minHeight: 36, padding: "6px 10px" }}>
              <option value="single">{t("One amount column")}</option>
              <option value="split">{t("Separate out / in columns")}</option>
            </select>
          </SettingRow>
          {splitAmounts ? (<>{col("debit", t("Money out"))}{col("credit", t("Money in"))}</>) : col("amount", t("Amount"))}
          {!splitAmounts && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, ...TYPE.caption, color: theme.text, padding: "6px 0" }}>
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} style={{ accentColor: theme.accent }} />
              {t("My bank shows spending as positive numbers")}
            </label>
          )}

          <div style={{ ...s.cardTitle, marginTop: SPACE.md }}>{t("Preview")}</div>
          {preview && preview.transactions.length ? (
            <div style={{ marginTop: SPACE.xs }}>
              {preview.transactions.slice(0, 5).map((tx, i) => (
                <div key={i} style={{ display: "flex", gap: SPACE.sm, ...TYPE.caption, padding: "4px 0", borderBottom: `1px solid ${theme.border}` }}>
                  <span style={{ color: theme.textMuted, width: 90, flexShrink: 0 }}>{tx.date}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.name}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: tx.amount < 0 ? theme.danger : theme.success }}>
                    {tx.amount < 0 ? "−" : "+"}{fmt(Math.abs(tx.amount))}
                  </span>
                </div>
              ))}
              <div style={{ ...hint, marginTop: 6 }}>
                {tn(preview.transactions.length, "{n} transaction read", "{n} transactions read")}
                {preview.skipped ? ` · ${tn(preview.skipped, "{n} row without a date or amount ignored", "{n} rows without a date or amount ignored")}` : ""}
                {` · ${t("dates read as {order}", { order: preview.dateOrder === "MDY" ? t("month/day") : preview.dateOrder === "YMD" ? t("year-month-day") : t("day/month") })}`}
              </div>
            </div>
          ) : (
            <div style={{ ...TYPE.caption, color: theme.danger, marginTop: SPACE.xs }}>{t("No transactions found with these columns. Check which column holds the date and the amount.")}</div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: SPACE.lg }}>
            <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setStep("pick")}>{t("← Choose another file")}</button>
            <button style={{ ...s.addBtn, opacity: preview?.transactions.length ? 1 : 0.5 }}
              disabled={!preview?.transactions.length} onClick={toReview}>{t("Review transactions →")}</button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap", margin: `${SPACE.xs}px 0` }}>
            <div style={{ ...TYPE.caption, color: theme.textMuted }}>
              {tn(tally.expense, "{n} expense", "{n} expenses")} · {tn(tally.credit, "{n} credit", "{n} credits")}
              {tally.markPaid ? ` · ${tn(tally.markPaid, "{n} marked paid", "{n} marked paid")}` : ""} · {tn(tally.skip, "{n} skipped", "{n} skipped")}
            </div>
            <div style={{ display: "flex", gap: SPACE.md }}>
              <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setAll(true)}>{t("Tick suggested")}</button>
              <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setAll(false)}>{t("Untick all")}</button>
            </div>
          </div>
          <div style={{ maxHeight: "50vh", overflowY: "auto", borderTop: `1px solid ${theme.border}` }}>
            {rows.map((r) => {
              const cats = r.amount < 0 ? (data.categories || []) : (data.creditCategories || []);
              const fallbackCat = r.amount < 0 ? "Uncategorized" : "Other";
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: SPACE.sm, padding: "8px 0",
                                         borderBottom: `1px solid ${theme.border}`, opacity: r.include ? 1 : 0.55 }}>
                  <input type="checkbox" checked={r.include} onChange={() => toggle(r.id)} style={{ accentColor: theme.accent, width: 16, height: 16 }} />
                  <span style={{ ...TYPE.caption, color: theme.textMuted, width: 86, flexShrink: 0 }}>{r.date}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ ...TYPE.caption, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</div>
                    <div style={{ ...TYPE.microLegal, color: r.action === "skip" ? theme.textFaint : r.action === "markPaid" ? theme.success : theme.textFaint,
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={(r.reasonKey ? t(r.reasonKey, r.reasonVars) : r.reason) || r.note}>
                      {t(ACTION_LABEL[r.action])}{r.rule ? ` · ${t("by your rule")}` : ""}{r.reason ? ` · ${r.reasonKey ? t(r.reasonKey, r.reasonVars) : r.reason}` : r.note ? ` · ${r.note}` : ""}
                    </div>
                  </div>
                  {(r.action === "expense" || r.action === "credit") ? (
                    <select value={r.category || fallbackCat} onChange={(e) => setCategory(r.id, e.target.value)}
                      disabled={!r.include} style={{ ...s.input, width: 150, minHeight: 32, padding: "4px 8px", ...TYPE.finePrint }}>
                      {[...new Set([fallbackCat, ...cats.map((c) => c.name)])].map((n) => <option key={n} value={n}>{catName(n)}</option>)}
                    </select>
                  ) : <span style={{ width: 150 }} />}
                  {(r.action === "expense" || r.action === "credit") && !r.rule ? (
                    <label title={t('Always file "{match}" this way when importing', { match: suggestMatch(r.bankName || r.name) })}
                      style={{ display: "flex", alignItems: "center", gap: 4, width: 62, ...TYPE.microLegal, color: theme.textMuted, cursor: "pointer", opacity: r.include ? 1 : 0.5 }}>
                      <input type="checkbox" checked={!!r.remember} disabled={!r.include} onChange={() => toggleRemember(r.id)} />
                      {t("Always")}
                    </label>
                  ) : <span style={{ width: 62 }} />}
                  <span style={{ width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, ...TYPE.caption,
                                 color: r.amount < 0 ? theme.danger : theme.success }}>
                    {r.amount < 0 ? "−" : "+"}{fmt(Math.abs(r.amount))}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: SPACE.md }}>
            <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setStep("map")}>{t("← Columns")}</button>
            <button style={{ ...s.addBtn, opacity: kept.length ? 1 : 0.5 }} disabled={!kept.length} onClick={doImport}>
              {tn(kept.length, "Import {n} item", "Import {n} items")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
