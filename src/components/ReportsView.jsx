import { dayRangeLabel, isoDay, monthKey, monthLabel } from "../lib/periods.js";
import { calendarFor } from "../lib/calendar.js";
import { JOINT, personById } from "../lib/people.js";
import { BASE_INCOME_NAME, buildReport, categoryChanges, comparisonFor, percentChange, rangeKeys, rangeOptions, reportToCsv } from "../lib/reports.js";
import { downloadText, fileDate } from "../exportFiles.js";
import { categoryBreakdown, CREDIT_UNCATEGORIZED, findCategory } from "../model.js";
import { currencyCode, fmt, fmtWhole } from "../money.js";
import { FONT, SPACE, TYPE, useThemed } from "../theme.js";
import { CategoryDonut, MonthlyBarChart } from "./charts.jsx";
import { CategoryPill, StatCard } from "./controls.jsx";
import { isSplit } from "../lib/splits.js";
import { fmtDate, t, tk, tn } from "../i18n.js";
import { catName } from "../text.js";
import { groupRows, groupTotals } from "../lib/groups.js";
import { useCollapsed } from "../hooks/useCollapsed.js";

// Two-digit alpha suffix for a #rrggbb colour.
function alphaHex(a) {
  return Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
}

function shortPeriod(cal, key, withYear) {
  const s = cal.shortLabel(key);
  return withYear ? `${s} ’${isoDay(cal.range(key).start).slice(2, 4)}` : s;
}

// Category by period. Each cell is shaded by where it sits between its own
// row's quietest and busiest period, so a category's rhythm shows at a glance
// whatever its size - and a bill that never changes stays pale instead of
// lighting up the whole row.
function CategoryTrends({ report, categories, curKey, cal, onOpenPeriod, groupOrder }) {
  const { theme } = useThemed();
  // Categories in groups show under their group's line, which folds away.
  const [collapsed, toggleGroup] = useCollapsed("reports");
  const sections = groupRows(report.categories, { categories, categoryGroups: groupOrder });
  const grouped = sections.some((g) => g.group != null);
  const withYear = report.keys.length > 0 && report.keys[0].slice(0, 4) !== report.keys[report.keys.length - 1].slice(0, 4);
  const line = `1px solid ${theme.border}`;
  const th = { ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.6px", color: theme.textFaint, fontWeight: 600,
               padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", borderBottom: line };
  const td = { ...TYPE.caption, padding: "8px 10px", textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums",
               whiteSpace: "nowrap", borderBottom: line };
  // The category column stays put while the periods scroll sideways.
  const sticky = { position: "sticky", left: 0, background: theme.surface, zIndex: 1, textAlign: "left" };
  const footer = [
    { label: tk("Spent"), values: report.periods.map((p) => p.spent), total: report.spent, avg: report.averageSpent, color: () => theme.text },
    { label: tk("Income"), values: report.periods.map((p) => p.income), total: report.income, avg: report.averageIncome, color: () => theme.text },
    { label: tk("Saved"), values: report.periods.map((p) => p.income - p.spent), total: report.saved, avg: report.averageSaved,
      color: (v) => (v >= 0 ? theme.success : theme.danger) },
  ];
  // One category, period by period.
  const categoryRow = (row) => {
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
        <td style={{ ...td, ...sticky, ...(grouped ? { paddingLeft: 26 } : null) }}>
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
  };

  // A group's own line: its categories added up, and a way to fold them away.
  const groupRow = (g) => {
    const key = g.group ?? "";
    const sum = groupTotals(g.rows);
    return (
      <tr key={`group-${key}`}>
        <td style={{ ...td, ...sticky, fontFamily: FONT }}>
          <button onClick={() => toggleGroup(key)} aria-expanded={!collapsed.has(key)}
            style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontWeight: 700, color: theme.text }}>
            <span style={{ display: "inline-block", transform: collapsed.has(key) ? "rotate(-90deg)" : "none", transition: "transform .15s" }}>▾</span>
            {g.group ?? t("Not in a group")}
          </button>
        </td>
        {sum.perPeriod.map((v, i) => <td key={report.keys[i]} style={{ ...td, fontWeight: 700 }}>{v ? fmtWhole(v) : "–"}</td>)}
        <td style={{ ...td, fontWeight: 700 }}>{fmtWhole(sum.total)}</td>
        <td style={{ ...td, color: theme.textMuted, fontWeight: 600 }}>{fmtWhole(sum.average)}</td>
      </tr>
    );
  };

  return (
    <div style={{ overflowX: "auto", marginTop: SPACE.md }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, ...sticky }}>{t("Category")}</th>
            {report.keys.map((k) => (
              <th key={k} style={th}>
                <button onClick={() => onOpenPeriod(k)}
                  title={k === curKey ? t("Still running · open on the Dashboard") : t("Open in History")}
                  style={{ all: "unset", cursor: "pointer" }}>
                  {shortPeriod(cal, k, withYear)}{k === curKey ? " •" : ""}
                </button>
              </th>
            ))}
            <th style={th}>{t("Total")}</th>
            <th style={th} title={report.averagedOver < report.keys.length ? t("Completed periods only") : undefined}>{t("Avg")}</th>
          </tr>
        </thead>
        <tbody>
          {sections.flatMap((g) => [
            grouped ? groupRow(g) : null,
            ...(grouped && collapsed.has(g.group ?? "") ? [] : g.rows.map(categoryRow)),
          ])}
        </tbody>
        <tfoot>
          {footer.map((f) => (
            <tr key={f.label}>
              <td style={{ ...td, ...sticky, fontWeight: 600, color: theme.textMuted, fontFamily: FONT }}>{t(f.label)}</td>
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

// Who paid for the range: each payer's total and average per period. It adds
// up to the report's Spent figure, hidden categories left out the same way.
function WhoPaid({ data, report }) {
  const { theme, s } = useThemed();
  // Joint and what nobody was marked for have no colour of their own.
  const nameOf = (payer) => (payer === JOINT ? t("Joint") : personById(data, payer)?.name ?? t("Not set"));
  const colorOf = (payer) => personById(data, payer)?.color ?? theme.textFaint;
  const col = { width: 84, flex: "none", textAlign: "right", whiteSpace: "nowrap", fontFamily: FONT, fontVariantNumeric: "tabular-nums" };
  const head = { ...TYPE.finePrint, textTransform: "uppercase", letterSpacing: "0.6px", color: theme.textFaint, fontWeight: 600 };
  return (
    <div style={{ ...s.card, marginTop: 16 }}>
      <div style={s.cardTitle}>{t("Who paid")}</div>
      <div style={{ ...s.tableRow, minHeight: 0, gap: SPACE.md, paddingTop: SPACE.xs, paddingBottom: SPACE.xs }}>
        <div style={{ flex: 1 }} />
        <div style={{ ...col, ...head }}>{t("Total")}</div>
        <div style={{ ...col, ...head }} title={report.averagedOver < report.keys.length ? t("Completed periods only") : undefined}>{t("Avg")}</div>
      </div>
      {report.byPerson.map((p) => (
        <div key={p.payer} style={{ ...s.tableRow, gap: SPACE.md }}>
          <i style={{ width: 10, height: 10, borderRadius: "50%", background: colorOf(p.payer), flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={nameOf(p.payer)}>{nameOf(p.payer)}</div>
          <div style={{ ...col, fontWeight: 700 }}>{fmt(p.total)}</div>
          <div style={{ ...col, color: theme.textMuted }}>{fmt(p.average)}</div>
        </div>
      ))}
    </div>
  );
}

export function ReportsView({ data, today, curKey, range, onRange, onOpenPeriod }) {
  const { theme, s } = useThemed();
  const cal = calendarFor(data);
  const options = rangeOptions(data, curKey);
  const rangeId = options.some((o) => o.id === range) ? range : (options[0]?.id || `year:${curKey.slice(0, 4)}`);
  const keys = rangeKeys(data, rangeId, curKey);
  // Averages and comparisons use completed periods only - half a month always
  // looks thrifty. The headline totals still include the running one.
  const report = buildReport(data, keys, today, { runningKey: curKey });
  const running = keys.includes(curKey);
  // Months or payday-to-payday periods: the two nouns decline differently in
  // Polish, so each wording is its own sentence rather than a word swapped in.
  const monthly = cal.calendarMonths;
  const cmp = comparisonFor(data, rangeId, curKey);
  // What the comparison is against, named in the reader's language: a year,
  // the stretch before, or - when that stretch was only partly tracked - the
  // months it actually covers (cmp.label, built from month names).
  const cmpLabel = !cmp ? ""
    : cmp.keys.length !== cmp.closed.length ? cmp.label
    : rangeId.startsWith("year:") ? String(Number(rangeId.slice(5)) - 1)
    : (monthly ? tn(Number(rangeId.slice(5)), "the month before", "the {n} months before") : tn(Number(rangeId.slice(5)), "the period before", "the {n} periods before"));
  const rangeLabel = (id) => {
    if (id === "all") return t("All time");
    if (id.startsWith("year:")) return id.slice(5) === curKey.slice(0, 4) ? t("This year ({year})", { year: id.slice(5) }) : id.slice(5);
    const n = Number(id.slice(5));
    return monthly ? t("Last {n} months", { n }) : t("Last {n} periods", { n });
  };
  const nowCmp = cmp ? buildReport(data, cmp.closed, today) : null;
  const beforeCmp = cmp ? buildReport(data, cmp.keys, today) : null;
  const changes = cmp ? categoryChanges(nowCmp, beforeCmp).slice(0, 6) : [];
  const perPeriod = (r, field) => (r.keys.length ? r[field] / r.keys.length : 0);
  const vs = (field) => {
    if (!cmp) return null;
    const d = percentChange(perPeriod(nowCmp, field), perPeriod(beforeCmp, field));
    if (d == null) return null;
    const pct = `${d >= 0 ? "↑" : "↓"} ${Math.abs(d * 100).toFixed(0)}%`;
    return monthly ? t("{pct} a month vs {other}", { pct, other: cmpLabel }) : t("{pct} a period vs {other}", { pct, other: cmpLabel });
  };

  const exportReport = () => {
    const csv = reportToCsv(report, {
      locale: data.locale || navigator.language,
      label: (k) => cal.label(k).primary,
    });
    downloadText(csv, `budget-ctrl-report-${rangeId.replace(":", "-")}-${fileDate()}.csv`, "text/csv;charset=utf-8");
  };

  // Months are named; a run of fortnights is given by its days.
  const allMonths = keys.every((k) => cal.kindOf(k) === "monthly");
  const runningName = cal.kindOf(curKey) === "monthly"
    ? monthLabel(monthKey(cal.range(curKey).start)).split(" ")[0]
    : cal.label(curKey).primary;
  const span = keys.length
    ? (allMonths
      ? `${monthLabel(keys[0])}${keys.length > 1 ? ` – ${monthLabel(keys[keys.length - 1])}` : ""}`
      : dayRangeLabel(cal.range(keys[0]).start, cal.range(keys[keys.length - 1]).end))
      + " · "
      + (monthly ? tn(keys.length, "{n} month tracked", "{n} months tracked") : tn(keys.length, "{n} period tracked", "{n} periods tracked"))
      + (running ? ` · ${t("{month} still running", { month: runningName })}` : "")
    : "";

  const year = rangeId.startsWith("year:") ? rangeId.slice(5) : null;
  const multiYear = keys.length > 0 && keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4);
  const byKey = new Map(report.periods.map((p) => [p.key, p]));
  // A calendar year always shows January to December, so a gap reads as a gap.
  // Fortnights are shown as they are.
  const monthBars = year && keys.every((k) => /^\d{4}-\d{2}$/.test(k));
  const bars = (monthBars
    ? Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`)
    : keys
  ).map((k) => ({ key: k, label: shortPeriod(cal, k, multiYear), spent: byKey.get(k)?.spent || 0, income: byKey.get(k)?.income || 0 }));

  const catDonut = categoryBreakdown(new Map(report.categories.map((c) => [c.name, c.total])), data.categories || []);
  const incomeDonut = report.incomeSources.map(({ name, value }) => {
    if (name === BASE_INCOME_NAME) return { name, value, color: theme.accent, icon: "💼" };
    const cat = (data.creditCategories || []).find((c) => c.name === name) || CREDIT_UNCATEGORIZED;
    return { name, value, color: cat.color, icon: cat.icon };
  });
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16 };
  const money = { fontFamily: FONT, fontVariantNumeric: "tabular-nums" };
  const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const shortDate = (iso) => fmtDate(iso, { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: SPACE.md, marginBottom: SPACE.md, flexWrap: "wrap" }}>
        <div>
          <select aria-label={t("Report range")} value={rangeId} onChange={(e) => onRange(e.target.value)}
            style={{ ...s.input, width: "auto", minWidth: 220, fontWeight: 600 }}>
            {options.map((o) => <option key={o.id} value={o.id}>{rangeLabel(o.id)}</option>)}
          </select>
          {span && <div style={{ ...TYPE.finePrint, color: theme.textMuted, marginTop: 6 }}>{span}</div>}
        </div>
        {keys.length > 0 && <button style={s.linkBtn} onClick={exportReport} title={t("Category by period, as a spreadsheet")}>{t("Export CSV")}</button>}
      </div>

      {keys.length === 0 ? (
        <div style={s.empty}>{t("Nothing recorded in this range.")}</div>
      ) : (
        <>
          <div style={s.statsRow}>
            <StatCard label={t("Income")} value={fmt(report.income)} accent={theme.success}
              sub={vs("income") || t("Base income and credits received")} icon="↑" />
            <StatCard label={t("Spent")} value={fmt(report.spent)} accent={theme.danger}
              sub={vs("spent") || (running ? t("Everything paid so far") : t("Everything paid"))} icon="↻" />
            <StatCard label={t("Saved")} value={fmt(report.saved)} accent={report.saved >= 0 ? theme.success : theme.danger}
              sub={report.savingsRate == null ? t("No income recorded") : t("{pct}% of income", { pct: Math.round(report.savingsRate * 100) })} icon="↓" />
            <StatCard label={monthly ? t("Avg per month") : t("Avg per period")} value={fmt(report.averageSpent)} accent={theme.accent}
              sub={running && report.averagedOver < keys.length
                ? (monthly ? tn(report.averagedOver, "Spent, over {n} completed month", "Spent, over {n} completed months") : tn(report.averagedOver, "Spent, over {n} completed period", "Spent, over {n} completed periods"))
                : (monthly ? tn(report.averagedOver, "Spent, over {n} month", "Spent, over {n} months") : tn(report.averagedOver, "Spent, over {n} period", "Spent, over {n} periods"))} icon="◐" />
          </div>
          {report.leftOut.length > 0 && (
            <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, margin: `-${SPACE.xs}px 0 ${SPACE.md}px` }}>
              {t("Left out of these reports: {list}. Your budget still counts them; change it in Categories.",
                { list: report.leftOut.map((c) => `${catName(c.name)} (${fmt(c.total)})`).join(", ") })}
            </div>
          )}

          <div style={s.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: SPACE.md }}>
              <div style={s.cardTitle}>{monthly ? t("Spent each month") : t("Spent each period")}</div>
              <div style={{ ...TYPE.finePrint, color: theme.textFaint }}>{t("Red where spending passed income")}</div>
            </div>
            <MonthlyBarChart data={bars} curKey={curKey} onBarClick={onOpenPeriod} monthly={monthly} />
          </div>

          <div style={{ ...s.card, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: SPACE.md }}>
              <div style={s.cardTitle}>{t("Spending by category")}</div>
              <div style={{ ...TYPE.finePrint, color: theme.textFaint }}>{monthly ? t("In {currency} · click a month to open it", { currency: data.currency || currencyCode() }) : t("In {currency} · click a period to open it", { currency: data.currency || currencyCode() })}</div>
            </div>
            {report.categories.length === 0
              ? <div style={s.emptySmall}>{t("Nothing spent in this range.")}</div>
              : <CategoryTrends report={report} categories={data.categories || []} groupOrder={data.categoryGroups} curKey={curKey} cal={cal} onOpenPeriod={onOpenPeriod} />}
          </div>

          {report.byPerson.length > 0 && <WhoPaid data={data} report={report} />}

          <div style={grid}>
            <div style={s.card}>
              <div style={s.cardTitle}>{cmp ? t("What changed · vs {other}", { other: cmpLabel }) : t("What changed")}</div>
              {!cmp ? (
                <div style={s.emptySmall}>{t("Nothing earlier to compare with yet.")}</div>
              ) : changes.length === 0 ? (
                <div style={s.emptySmall}>{t("No category moved.")}</div>
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
                            {monthly ? t("{now} a month, was {before}", { now: fmt(c.now), before: fmt(c.before) }) : t("{now} a period, was {before}", { now: fmt(c.now), before: fmt(c.before) })}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", whiteSpace: "nowrap", ...money }}>
                          <div style={{ fontWeight: 700, color: up ? theme.danger : theme.success }}>{up ? "↑" : "↓"} {fmt(Math.abs(c.delta))}</div>
                          {c.pct != null && <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: 2 }}>{up ? "+" : "−"}{Math.abs(c.pct * 100).toFixed(0)}%</div>}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: SPACE.sm }}>
                    {monthly ? t("Average per month, completed months only.") : t("Average per period, completed periods only.")}
                  </div>
                </>
              )}
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>{t("Where it went")}</div>
              <CategoryDonut data={catDonut} total={report.spent} />
            </div>
          </div>

          <div style={grid}>
            <div style={s.card}>
              <div style={s.cardTitle}>{t("Biggest one-off payments")}</div>
              {report.biggest.length === 0 ? (
                <div style={s.emptySmall}>{t("No one-off payments in this range.")}</div>
              ) : (
                report.biggest.map(({ entry, periodKey, amount }) => (
                  <div key={`${periodKey}-${entry.id}`} style={{ ...s.tableRow, gap: SPACE.md }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...ellipsis, fontWeight: 600 }} title={entry.name}>{entry.name}</div>
                      <div style={{ ...ellipsis, ...TYPE.finePrint, color: theme.textFaint, marginTop: 2 }}>
                        {isSplit(entry) ? t("Split · {parts}", { parts: entry.splits.map((p) => p.category).join(", ") }) : (entry.category || t("Uncategorized"))} · {shortDate(entry.date || entry.dueDate)}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, color: theme.danger, whiteSpace: "nowrap", ...money }}>{fmt(amount)}</div>
                  </div>
                ))
              )}
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>{t("Top payees")}</div>
              {report.payees.length === 0 ? (
                <div style={s.emptySmall}>{t("No payments in this range.")}</div>
              ) : (
                <>
                  {report.payees.map((p) => (
                    <div key={p.key} style={{ ...s.tableRow, gap: SPACE.md }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...ellipsis, fontWeight: 600 }} title={p.name}>{p.name}</div>
                        <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: 2 }}>
                          {tn(p.count, "{n} payment", "{n} payments")}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, whiteSpace: "nowrap", ...money }}>{fmt(p.total)}</div>
                    </div>
                  ))}
                  <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: SPACE.sm }}>{t("Same name, ignoring store numbers and capitals.")}</div>
                </>
              )}
            </div>
          </div>

          <div style={grid}>
            <div style={s.card}>
              <div style={s.cardTitle}>{t("Income sources")}</div>
              <CategoryDonut data={incomeDonut} total={report.income} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
