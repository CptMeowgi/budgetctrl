import { monthLabel, periodLabel } from "../lib/periods.js";
import { BASE_INCOME_NAME, buildReport, categoryChanges, comparisonFor, percentChange, periodNoun, rangeKeys, rangeOptions, reportToCsv } from "../lib/reports.js";
import { downloadText, fileDate } from "../exportFiles.js";
import { categoryBreakdown, CREDIT_UNCATEGORIZED, findCategory } from "../model.js";
import { currencyCode, fmt, fmtWhole } from "../money.js";
import { FONT, SPACE, TYPE, useThemed } from "../theme.js";
import { CategoryDonut, MonthlyBarChart } from "./charts.jsx";
import { CategoryPill, StatCard } from "./controls.jsx";

// Two-digit alpha suffix for a #rrggbb colour.
function alphaHex(a) {
  return Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
}

function shortPeriod(key, withYear) {
  const m = monthLabel(key).slice(0, 3);
  return withYear ? `${m} ’${key.slice(2, 4)}` : m;
}

// Category by period. Each cell is shaded by where it sits between its own
// row's quietest and busiest period, so a category's rhythm shows at a glance
// whatever its size - and a bill that never changes stays pale instead of
// lighting up the whole row.
function CategoryTrends({ report, categories, curKey, onOpenPeriod }) {
  const { theme } = useThemed();
  const withYear = report.keys.length > 0 && report.keys[0].slice(0, 4) !== report.keys[report.keys.length - 1].slice(0, 4);
  const line = `1px solid ${theme.border}`;
  const th = { ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.6px", color: theme.textFaint, fontWeight: 600,
               padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", borderBottom: line };
  const td = { ...TYPE.caption, padding: "8px 10px", textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums",
               whiteSpace: "nowrap", borderBottom: line };
  // The category column stays put while the periods scroll sideways.
  const sticky = { position: "sticky", left: 0, background: theme.surface, zIndex: 1, textAlign: "left" };
  const footer = [
    { label: "Spent", values: report.periods.map((p) => p.spent), total: report.spent, avg: report.averageSpent, color: () => theme.text },
    { label: "Income", values: report.periods.map((p) => p.income), total: report.income, avg: report.averageIncome, color: () => theme.text },
    { label: "Saved", values: report.periods.map((p) => p.income - p.spent), total: report.saved, avg: report.averageSaved,
      color: (v) => (v >= 0 ? "#10b981" : "#ef4444") },
  ];
  return (
    <div style={{ overflowX: "auto", marginTop: SPACE.md }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, ...sticky }}>Category</th>
            {report.keys.map((k) => (
              <th key={k} style={th}>
                <button onClick={() => onOpenPeriod(k)}
                  title={k === curKey ? "Still running · open on the Dashboard" : "Open in History"}
                  style={{ all: "unset", cursor: "pointer" }}>
                  {shortPeriod(k, withYear)}{k === curKey ? " •" : ""}
                </button>
              </th>
            ))}
            <th style={th}>Total</th>
            <th style={th} title={report.averagedOver < report.keys.length ? "Completed periods only" : undefined}>Avg</th>
          </tr>
        </thead>
        <tbody>
          {report.categories.map((row) => {
            const cat = findCategory(categories, row.name) || { name: row.name, color: "#9ca3af", icon: "·" };
            // Scaled on completed periods: a half-finished month is always low
            // and would make every full one look busy.
            const settled = row.perPeriod.filter((_, i) => report.keys[i] !== curKey);
            const scale = settled.length ? settled : row.perPeriod;
            const lo = Math.min(...scale);
            const hi = Math.max(...scale);
            const shade = (v) => `${cat.color}${alphaHex(0.06 + (hi > lo ? 0.24 * Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0))}`;
            return (
              <tr key={row.name}>
                <td style={{ ...td, ...sticky }}>
                  <CategoryPill categoryName={row.name} categories={categories} fallback={cat} />
                </td>
                {row.perPeriod.map((v, i) => (
                  <td key={report.keys[i]} style={{
                    ...td, color: v ? theme.text : theme.textFaint,
                    background: v > 0 ? shade(v) : "transparent",
                  }}>{v ? fmtWhole(v) : "–"}</td>
                ))}
                <td style={{ ...td, fontWeight: 700 }}>{fmtWhole(row.total)}</td>
                <td style={{ ...td, color: theme.textMuted }}>{fmtWhole(row.average)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {footer.map((f) => (
            <tr key={f.label}>
              <td style={{ ...td, ...sticky, fontWeight: 600, color: theme.textMuted, fontFamily: FONT }}>{f.label}</td>
              {f.values.map((v, i) => (
                <td key={report.keys[i]} style={{ ...td, fontWeight: 600, color: f.color(v) }}>{fmtWhole(v)}</td>
              ))}
              <td style={{ ...td, fontWeight: 700, color: f.color(f.total) }}>{fmtWhole(f.total)}</td>
              <td style={{ ...td, color: theme.textMuted }}>{fmtWhole(f.avg)}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}

export function ReportsView({ data, today, curKey, range, onRange, onOpenPeriod }) {
  const { theme, s } = useThemed();
  const cutoffDay = data.cutoffDay || 1;
  const options = rangeOptions(data, curKey);
  const rangeId = options.some((o) => o.id === range) ? range : (options[0]?.id || `year:${curKey.slice(0, 4)}`);
  const keys = rangeKeys(data, rangeId, curKey);
  // Averages and comparisons use completed periods only - half a month always
  // looks thrifty. The headline totals still include the running one.
  const report = buildReport(data, keys, today, { runningKey: curKey });
  const running = keys.includes(curKey);
  const one = periodNoun(cutoffDay, 1);
  const cmp = comparisonFor(data, rangeId, curKey);
  const nowCmp = cmp ? buildReport(data, cmp.closed, today) : null;
  const beforeCmp = cmp ? buildReport(data, cmp.keys, today) : null;
  const changes = cmp ? categoryChanges(nowCmp, beforeCmp).slice(0, 6) : [];
  const perPeriod = (r, field) => (r.keys.length ? r[field] / r.keys.length : 0);
  const vs = (field) => {
    if (!cmp) return null;
    const d = percentChange(perPeriod(nowCmp, field), perPeriod(beforeCmp, field));
    if (d == null) return null;
    return `${d >= 0 ? "↑" : "↓"} ${Math.abs(d * 100).toFixed(0)}% a ${one} vs ${cmp.label}`;
  };

  const exportReport = () => {
    const csv = reportToCsv(report, {
      locale: data.locale || navigator.language,
      label: (k) => periodLabel(k, cutoffDay).primary,
    });
    downloadText(csv, `budget-ctrl-report-${rangeId.replace(":", "-")}-${fileDate()}.csv`, "text/csv;charset=utf-8");
  };

  const span = keys.length
    ? `${monthLabel(keys[0])}${keys.length > 1 ? ` – ${monthLabel(keys[keys.length - 1])}` : ""} · ${keys.length} ${periodNoun(cutoffDay, keys.length)} tracked`
      + (running ? ` · ${monthLabel(curKey).split(" ")[0]} still running` : "")
    : "";

  const year = rangeId.startsWith("year:") ? rangeId.slice(5) : null;
  const multiYear = keys.length > 0 && keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4);
  const byKey = new Map(report.periods.map((p) => [p.key, p]));
  // A calendar year always shows January to December, so a gap reads as a gap.
  const bars = (year
    ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)
    : keys
  ).map((k) => ({ key: k, label: shortPeriod(k, multiYear), spent: byKey.get(k)?.spent || 0, income: byKey.get(k)?.income || 0 }));

  const catDonut = categoryBreakdown(new Map(report.categories.map((c) => [c.name, c.total])), data.categories || []);
  const incomeDonut = report.incomeSources.map(({ name, value }) => {
    if (name === BASE_INCOME_NAME) return { name, value, color: "#0066cc", icon: "💼" };
    const cat = (data.creditCategories || []).find((c) => c.name === name) || CREDIT_UNCATEGORIZED;
    return { name, value, color: cat.color, icon: cat.icon };
  });
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16 };
  const money = { fontFamily: FONT, fontVariantNumeric: "tabular-nums" };
  const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const shortDate = (iso) => {
    const d = iso ? new Date(`${iso}T00:00:00`) : null;
    return d && !isNaN(d) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: SPACE.md, marginBottom: SPACE.md, flexWrap: "wrap" }}>
        <div>
          <select aria-label="Report range" value={rangeId} onChange={(e) => onRange(e.target.value)}
            style={{ ...s.input, width: "auto", minWidth: 220, fontWeight: 600 }}>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {span && <div style={{ ...TYPE.finePrint, color: theme.textMuted, marginTop: 6 }}>{span}</div>}
        </div>
        {keys.length > 0 && <button style={s.linkBtn} onClick={exportReport} title="Category by period, as a spreadsheet">Export CSV</button>}
      </div>

      {keys.length === 0 ? (
        <div style={s.empty}>Nothing recorded in this range.</div>
      ) : (
        <>
          <div style={s.statsRow}>
            <StatCard label="Income" value={fmt(report.income)} accent="#10b981"
              sub={vs("income") || "Base income and credits received"} icon="↑" />
            <StatCard label="Spent" value={fmt(report.spent)} accent="#ef4444"
              sub={vs("spent") || (running ? "Everything paid so far" : "Everything paid")} icon="↻" />
            <StatCard label="Saved" value={fmt(report.saved)} accent={report.saved >= 0 ? "#10b981" : "#ef4444"}
              sub={report.savingsRate == null ? "No income recorded" : `${Math.round(report.savingsRate * 100)}% of income`} icon="↓" />
            <StatCard label={`Avg per ${one}`} value={fmt(report.averageSpent)} accent="#0066cc"
              sub={`Spent, over ${report.averagedOver}${running && report.averagedOver < keys.length ? " completed" : ""} ${periodNoun(cutoffDay, report.averagedOver)}`} icon="◐" />
          </div>

          <div style={s.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: SPACE.md }}>
              <div style={s.cardTitle}>Spent each {one}</div>
              <div style={{ ...TYPE.finePrint, color: theme.textFaint }}>Red where spending passed income</div>
            </div>
            <MonthlyBarChart data={bars} curKey={curKey} onBarClick={onOpenPeriod} />
          </div>

          <div style={{ ...s.card, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: SPACE.md }}>
              <div style={s.cardTitle}>Spending by category</div>
              <div style={{ ...TYPE.finePrint, color: theme.textFaint }}>In {data.currency || currencyCode()} · click a {one} to open it</div>
            </div>
            {report.categories.length === 0
              ? <div style={s.emptySmall}>Nothing spent in this range.</div>
              : <CategoryTrends report={report} categories={data.categories || []} curKey={curKey} onOpenPeriod={onOpenPeriod} />}
          </div>

          <div style={grid}>
            <div style={s.card}>
              <div style={s.cardTitle}>What changed{cmp ? ` · vs ${cmp.label}` : ""}</div>
              {!cmp ? (
                <div style={s.emptySmall}>Nothing earlier to compare with yet.</div>
              ) : changes.length === 0 ? (
                <div style={s.emptySmall}>No category moved.</div>
              ) : (
                <>
                  {changes.map((c) => {
                    const up = c.delta > 0;
                    return (
                      <div key={c.name} style={{ ...s.tableRow, gap: SPACE.md }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <CategoryPill categoryName={c.name} categories={data.categories || []}
                            fallback={{ name: c.name, color: "#9ca3af", icon: "·" }} />
                          <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: 4, ...money }}>
                            {fmt(c.now)} a {one}, was {fmt(c.before)}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", whiteSpace: "nowrap", ...money }}>
                          <div style={{ fontWeight: 700, color: up ? "#ef4444" : "#10b981" }}>{up ? "↑" : "↓"} {fmt(Math.abs(c.delta))}</div>
                          {c.pct != null && <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: 2 }}>{up ? "+" : "−"}{Math.abs(c.pct * 100).toFixed(0)}%</div>}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: SPACE.sm }}>
                    Average per {one}, completed {periodNoun(cutoffDay)} only.
                  </div>
                </>
              )}
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>Where it went</div>
              <CategoryDonut data={catDonut} total={report.spent} />
            </div>
          </div>

          <div style={grid}>
            <div style={s.card}>
              <div style={s.cardTitle}>Biggest one-off payments</div>
              {report.biggest.length === 0 ? (
                <div style={s.emptySmall}>No one-off payments in this range.</div>
              ) : (
                report.biggest.map(({ entry, periodKey }) => (
                  <div key={`${periodKey}-${entry.id}`} style={{ ...s.tableRow, gap: SPACE.md }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...ellipsis, fontWeight: 600 }} title={entry.name}>{entry.name}</div>
                      <div style={{ ...ellipsis, ...TYPE.finePrint, color: theme.textFaint, marginTop: 2 }}>
                        {entry.category || "Uncategorized"} · {shortDate(entry.date || entry.dueDate)}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, color: "#ef4444", whiteSpace: "nowrap", ...money }}>{fmt(entry.amount)}</div>
                  </div>
                ))
              )}
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>Top payees</div>
              {report.payees.length === 0 ? (
                <div style={s.emptySmall}>No payments in this range.</div>
              ) : (
                <>
                  {report.payees.map((p) => (
                    <div key={p.key} style={{ ...s.tableRow, gap: SPACE.md }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...ellipsis, fontWeight: 600 }} title={p.name}>{p.name}</div>
                        <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: 2 }}>
                          {p.count} payment{p.count !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, whiteSpace: "nowrap", ...money }}>{fmt(p.total)}</div>
                    </div>
                  ))}
                  <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: SPACE.sm }}>
                    Same name, ignoring store numbers and capitals.
                  </div>
                </>
              )}
            </div>
          </div>

          <div style={grid}>
            <div style={s.card}>
              <div style={s.cardTitle}>Income sources</div>
              <CategoryDonut data={incomeDonut} total={report.income} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
