import { useState } from "react";
import { analyzeImport, applyImport, decodeBytes, findHeaderRow, guessMapping, parseCsv, sniffDelimiter, toTransactions } from "../lib/importer.js";
import { uid } from "../model.js";
import { fmt } from "../money.js";
import { SPACE, TYPE, useThemed } from "../theme.js";
import { SettingRow } from "./controls.jsx";
import { Modal } from "./Modal.jsx";

const ACTION_LABEL = { expense: "Expense", credit: "Credit", markPaid: "Marks paid", skip: "Skip" };

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
      if (parsed.length < 2) { setError("That file doesn't contain a table of transactions."); return; }
      const headerIndex = findHeaderRow(parsed);
      const m = guessMapping(parsed[headerIndex]);
      setFile({ name: f.name, encoding, delimiter, rows: parsed, headerIndex });
      setMapping(m);
      setSplitAmounts(m.amount < 0 && (m.debit >= 0 || m.credit >= 0));
      setInvert(false);
      setError("");
      setStep("map");
    } catch {
      setError("Couldn't read that file. Export a CSV from your bank and try again.");
    }
  };

  const header = file ? file.rows[file.headerIndex] : [];
  const effective = mapping && (splitAmounts ? { ...mapping, amount: -1 } : { ...mapping, debit: -1, credit: -1 });
  const preview = file && effective ? toTransactions(file.rows, file.headerIndex, effective, { invert }) : null;

  const col = (key, label) => (
    <SettingRow label={label}>
      <select value={mapping[key]} onChange={(e) => setMapping({ ...mapping, [key]: +e.target.value })}
        style={{ ...s.input, width: 230, minHeight: 36, padding: "6px 10px" }}>
        <option value={-1}>— none —</option>
        {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
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
  const setCategory = (id, category) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, category } : r)));
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
    const { data: next, counts } = applyImport(data, rows, () => `${uid()}${++n}`);
    onImport(next, counts);
  };

  const hint = { ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint };

  return (
    <Modal title="Import bank statement" onClose={onClose} width={step === "review" ? 820 : 560}>
      {step === "pick" && (
        <div style={{ padding: `${SPACE.sm}px 0` }}>
          <div style={{ ...TYPE.caption, color: theme.textMuted, lineHeight: 1.5, marginBottom: SPACE.md }}>
            Export your transactions from online banking as CSV, then choose the file. You'll check every
            row before anything is added.
          </div>
          <label style={{ ...s.addBtn, display: "inline-block" }}>
            Choose CSV file…
            <input type="file" accept=".csv,.txt,text/csv" onChange={onFile} style={{ display: "none" }} />
          </label>
          {error && <div style={{ ...TYPE.caption, color: theme.danger, marginTop: SPACE.sm }}>{error}</div>}
          <div style={{ ...hint, marginTop: SPACE.md }}>
            Payments already in your budget — recurring bills, your salary, things you entered by hand — are
            recognised and left unticked, so nothing is counted twice.
          </div>
        </div>
      )}

      {step === "map" && file && (
        <div>
          <div style={{ ...hint, marginBottom: SPACE.xs }}>
            {file.name} · {file.encoding === "utf-8" ? "UTF-8" : "Windows-1250"} · separated by{" "}
            {file.delimiter === "\t" ? "tabs" : `"${file.delimiter}"`} · {file.rows.length - file.headerIndex - 1} rows
          </div>
          {col("date", "Date")}
          {col("payee", "Name (who was paid)")}
          {col("title", "Description")}
          <SettingRow label="Amounts" hint={splitAmounts ? "Money out and money in are in separate columns." : "One column; spending is negative."}>
            <select value={splitAmounts ? "split" : "single"} onChange={(e) => setSplitAmounts(e.target.value === "split")}
              style={{ ...s.input, width: 230, minHeight: 36, padding: "6px 10px" }}>
              <option value="single">One amount column</option>
              <option value="split">Separate out / in columns</option>
            </select>
          </SettingRow>
          {splitAmounts ? (<>{col("debit", "Money out")}{col("credit", "Money in")}</>) : col("amount", "Amount")}
          {!splitAmounts && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, ...TYPE.caption, color: theme.text, padding: "6px 0" }}>
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} style={{ accentColor: theme.accent }} />
              My bank shows spending as positive numbers
            </label>
          )}

          <div style={{ ...s.cardTitle, marginTop: SPACE.md }}>Preview</div>
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
                {preview.transactions.length} transaction{preview.transactions.length !== 1 ? "s" : ""} read
                {preview.skipped ? ` · ${preview.skipped} row${preview.skipped !== 1 ? "s" : ""} without a date or amount ignored` : ""}
                {` · dates read as ${preview.dateOrder === "MDY" ? "month/day" : preview.dateOrder === "YMD" ? "year-month-day" : "day/month"}`}
              </div>
            </div>
          ) : (
            <div style={{ ...TYPE.caption, color: theme.danger, marginTop: SPACE.xs }}>
              No transactions found with these columns. Check which column holds the date and the amount.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: SPACE.lg }}>
            <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setStep("pick")}>← Choose another file</button>
            <button style={{ ...s.addBtn, opacity: preview?.transactions.length ? 1 : 0.5 }}
              disabled={!preview?.transactions.length} onClick={toReview}>Review transactions →</button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap", margin: `${SPACE.xs}px 0` }}>
            <div style={{ ...TYPE.caption, color: theme.textMuted }}>
              {tally.expense} expense{tally.expense !== 1 ? "s" : ""} · {tally.credit} credit{tally.credit !== 1 ? "s" : ""}
              {tally.markPaid ? ` · ${tally.markPaid} marked paid` : ""} · {tally.skip} skipped
            </div>
            <div style={{ display: "flex", gap: SPACE.md }}>
              <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setAll(true)}>Tick suggested</button>
              <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setAll(false)}>Untick all</button>
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
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason || r.note}>
                      {ACTION_LABEL[r.action]}{r.reason ? ` · ${r.reason}` : r.note ? ` · ${r.note}` : ""}
                    </div>
                  </div>
                  {(r.action === "expense" || r.action === "credit") ? (
                    <select value={r.category || fallbackCat} onChange={(e) => setCategory(r.id, e.target.value)}
                      disabled={!r.include} style={{ ...s.input, width: 150, minHeight: 32, padding: "4px 8px", ...TYPE.finePrint }}>
                      {[...new Set([fallbackCat, ...cats.map((c) => c.name)])].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  ) : <span style={{ width: 150 }} />}
                  <span style={{ width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, ...TYPE.caption,
                                 color: r.amount < 0 ? theme.danger : theme.success }}>
                    {r.amount < 0 ? "−" : "+"}{fmt(Math.abs(r.amount))}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: SPACE.md }}>
            <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setStep("map")}>← Columns</button>
            <button style={{ ...s.addBtn, opacity: kept.length ? 1 : 0.5 }} disabled={!kept.length} onClick={doImport}>
              Import {kept.length} item{kept.length !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
