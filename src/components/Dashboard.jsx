import { useRef } from "react";
import { Area, AreaChart, ReferenceDot, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { balanceHistory, spendingByDay } from "../lib/forecast.js";
import { percentChange } from "../lib/reports.js";
import { categoryAverage } from "../lib/totals.js";
import { envelope } from "../lib/envelopes.js";
import { findCategory, CREDIT_UNCATEGORIZED, UNCATEGORIZED } from "../model.js";
import { fmt } from "../money.js";
import { catName, due } from "../text.js";
import { FONT, SPACE, TYPE, useThemed } from "../theme.js";
import { CategoryBudgets } from "./CategoryBudgets.jsx";
import { InfoHint } from "./controls.jsx";
import { Icon } from "./Icon.jsx";
import { fmtDate, t, tk, tn } from "../i18n.js";
import { useReflowAnimation } from "../hooks/useReflowAnimation.js";

const money = { fontFamily: FONT, fontVariantNumeric: "tabular-nums" };
const shortDay = (iso) => fmtDate(iso, { day: "numeric", month: "short" });

// A small up/down figure beside a headline amount, tinted by what it means.
function Chip({ tone, children, title }) {
  const { theme } = useThemed();
  const fg = tone === "good" ? theme.success : tone === "bad" ? theme.danger : theme.warning;
  const bg = tone === "good" ? theme.successSoft : tone === "bad" ? theme.dangerSoft : theme.warningSoft;
  return (
    <span title={title} style={{ height: 24, display: "inline-flex", alignItems: "center", gap: 3, padding: "0 8px", borderRadius: 7,
                                 fontSize: 11, fontWeight: 700, color: fg, background: bg, whiteSpace: "nowrap" }}>{children}</span>
  );
}

// Money left this period: the actual line so far, then the forecast to payday.
function MoneyLeftCard({ data, curKey, today, cal, fc, remaining, sub, stillToPay, goalsLine }) {
  const { theme, s } = useThemed();
  const history = balanceHistory(data, curKey, today);
  const ahead = new Map(fc.series.map((p) => [p.date, p.withEveryday]));
  const lastActual = history[history.length - 1];
  const days = cal.days(curKey);
  const points = days.map((d) => {
    const h = history.find((p) => p.date === d);
    return { date: d, actual: h ? h.balance : null, ahead: ahead.has(d) ? ahead.get(d) : null };
  });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => days[Math.round(f * (days.length - 1))]);
  const short = fc.runsShortOn;
  const monthly = cal.calendarMonths;

  return (
    <article style={{ ...s.card, background: theme.heroBg, borderRadius: 28, padding: "22px 24px", minHeight: 310, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: SPACE.md }}>
        <div style={{ minWidth: 0 }}>
          <span style={s.cardLabel}>{t("Remaining")}</span>
          <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ ...money, fontSize: 28, lineHeight: 1.2, letterSpacing: "-1px", color: remaining >= 0 ? theme.text : theme.danger }}>{fmt(remaining)}</strong>
            {fc.series.length > 1 && (short
              ? <Chip tone="bad"><Icon name="arrow-down" size={12} />{t("Runs short around {date} at this pace", { date: shortDay(short) })}</Chip>
              : <Chip tone="good"><Icon name="arrow-up" size={12} />{t("About {amount} left at the end", { amount: fmt(fc.endWithEveryday) })}</Chip>)}
          </div>
          <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 6 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", gap: SPACE.lg, flexShrink: 0, textAlign: "right" }}>
          <div>
            <span style={s.cardLabel}>{t("Still to Pay")}</span>
            <div style={{ ...money, fontWeight: 700, fontSize: 16, color: theme.warning, marginTop: 4 }}>{fmt(stillToPay)}</div>
          </div>
          {goalsLine && (
            <div>
              <span style={s.cardLabel}>{t("Saved for Goals")}</span>
              <div style={{ ...money, fontWeight: 700, fontSize: 16, color: theme.accent, marginTop: 4 }}>{goalsLine.saved}</div>
              <div style={{ fontSize: 11, color: theme.textFaint, marginTop: 2 }}>{goalsLine.sub}</div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: SPACE.md, fontSize: 11, color: theme.textFaint }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><i style={{ width: 7, height: 7, borderRadius: "50%", background: theme.accent }} />{t("So far")}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><i style={{ width: 7, height: 7, borderRadius: "50%", background: theme.warning }} />{t("Forecast")}</span>
      </div>
      <div style={{ flex: 1, minHeight: 170, marginTop: 4 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 12, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="mlFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={theme.accent} stopOpacity={0.24} />
                <stop offset="55%" stopColor={theme.success} stopOpacity={0.08} />
                <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="mlStroke" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor={theme.success} />
                <stop offset="100%" stopColor={theme.accent} />
              </linearGradient>
              <linearGradient id="mlAhead" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={theme.warning} stopOpacity={0.14} />
                <stop offset="100%" stopColor={theme.warning} stopOpacity={0} />
              </linearGradient>
              <pattern id="mlBars" width="10" height="10" patternUnits="userSpaceOnUse">
                <line x1="1.5" x2="1.5" y1="0" y2="10" stroke={theme.accent} strokeWidth="3" strokeOpacity="0.22" />
              </pattern>
            </defs>
            <XAxis dataKey="date" ticks={ticks} tickFormatter={shortDay} stroke={theme.textSoft} fontSize={11} tickLine={false} axisLine={false} interval={0} padding={{ left: 18, right: 18 }} />
            <YAxis hide domain={["dataMin - 200", "dataMax + 200"]} />
            <RTooltip cursor={{ stroke: theme.border }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              const v = p.actual ?? p.ahead;
              if (v == null) return null;
              return (
                <div style={s.chartTooltip}>
                  <span style={{ color: theme.textFaint, marginRight: 7 }}>{shortDay(p.date)}</span>
                  <strong style={money}>{fmt(v)}</strong>
                </div>
              );
            }} />
            <Area type="monotone" dataKey="ahead" stroke={theme.warning} strokeWidth={2} strokeDasharray="5 5" fill="url(#mlAhead)" connectNulls={false} dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="actual" stroke="none" fill="url(#mlBars)" connectNulls={false} dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="actual" stroke="url(#mlStroke)" strokeWidth={2.8} fill="url(#mlFill)" connectNulls={false} dot={false} isAnimationActive={false} />
            {lastActual && <ReferenceDot x={lastActual.date} y={lastActual.balance} r={10} fill={theme.accent} fillOpacity={0.12} stroke="none" />}
            {lastActual && <ReferenceDot x={lastActual.date} y={lastActual.balance} r={5} fill={theme.accent} stroke={theme.canvas} strokeWidth={3} />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {!monthly && <div style={{ fontSize: 11, color: theme.textSoft, marginTop: 2 }}>{cal.label(curKey).range}</div>}
    </article>
  );
}

// This period's spending: the running total day by day, how it compares with
// the same day last period, and the three biggest categories.
function SpendingCard({ data, curKey, today, cal, spent, effectiveIncome, spentByCat, onReports }) {
  const { theme, s } = useThemed();
  const daily = spendingByDay(data, curKey, today);
  const prevKey = cal.prev(curKey);
  const prev = data.months?.[prevKey] ? spendingByDay(data, prevKey, today) : [];
  const atSameDay = prev.length ? prev[Math.min(daily.length, prev.length) - 1].total : 0;
  const change = percentChange(spent, atSameDay);
  const monthly = cal.calendarMonths;
  const pctOfIncome = effectiveIncome > 0 ? Math.round((spent / effectiveIncome) * 100) : null;
  const top = [...spentByCat.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, v]) => ({ name, v, color: (findCategory(data.categories || [], name) || UNCATEGORIZED).color }));
  const days = cal.days(curKey);
  // Each bubble is at least as wide as its amount needs, so a narrow card
  // puts fewer in a row instead of letting the figures spill out, and one
  // left alone on a row stretches across it.
  const chipMin = Math.max(92, Math.ceil(Math.max(0, ...top.map((c) => fmt(c.v).length)) * 7.4) + 20);
  const chipsRef = useRef(null);
  useReflowAnimation(chipsRef);

  return (
    // overflow: hidden keeps a bubble that is still gliding to its new row
    // inside the card, sliding in from its edge.
    <article style={{ ...s.card, background: theme.warmBg, borderRadius: 28, padding: "22px 24px", minHeight: 310, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <span style={s.cardLabel}>{t("Total Spent")}</span>
      <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ ...money, fontSize: 24, lineHeight: 1.2, letterSpacing: "-1px" }}>{fmt(spent)}</strong>
        {change != null && (
          <Chip tone={change > 0 ? "warn" : "good"}
            title={monthly ? t("Compared with the same day last month") : t("Compared with the same day last period")}>
            <Icon name={change > 0 ? "arrow-up" : "arrow-down"} size={12} />{Math.abs(change * 100).toFixed(1)}%
          </Chip>
        )}
      </div>

      <div style={{ position: "relative", marginTop: 14, padding: "26px 0 18px", border: `1px solid ${theme.border}`, borderRadius: 18, background: theme.mode === "dark" ? "rgba(0,0,0,.13)" : theme.bg, overflow: "hidden" }}>
        <div style={{ position: "absolute", zIndex: 1, inset: "9px 12px auto", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: theme.textFaint }}>
          <span>{t("Spending so far")}</span>
          {pctOfIncome != null && <strong style={{ color: theme.warning, fontSize: 13 }}>{t("{pct}% of income", { pct: pctOfIncome })}</strong>}
        </div>
        <div style={{ height: 72 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="spFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={theme.warning} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={theme.warning} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide domain={[days[0], days[days.length - 1]]} />
              <YAxis hide domain={[0, "dataMax"]} />
              <Area type="monotone" dataKey="total" stroke={theme.warning} strokeWidth={2.3} fill="url(#spFill)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ position: "absolute", inset: "auto 12px 6px", display: "flex", justifyContent: "space-between", fontSize: 10, color: theme.textSoft }}>
          <span>{shortDay(days[0])}</span>
          <span>{shortDay(daily[daily.length - 1]?.date || days[0])}</span>
        </div>
      </div>

      {top.length > 0 && (
        <div ref={chipsRef} style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {top.map((c) => (
            <div key={c.name} style={{ flex: `1 1 ${chipMin}px`, minWidth: 0, boxSizing: "border-box", padding: "7px 9px", border: `1px solid ${theme.border}`, borderRadius: 10, background: theme.bg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: theme.textFaint, overflow: "hidden" }}>
                <i style={{ width: 6, height: 6, borderRadius: "50%", background: c.color, flex: "none" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catName(c.name)}</span>
              </div>
              <strong style={{ ...money, fontSize: 12, display: "block", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fmt(c.v)}</strong>
            </div>
          ))}
        </div>
      )}
      <button style={{ ...s.linkBtn, display: "flex", alignItems: "center", gap: 5, marginTop: "auto", paddingTop: 12, paddingBottom: 0 }} onClick={onReports}>
        {t("Spending report")} <Icon name="chevron" size={14} />
      </button>
    </article>
  );
}

// The latest expenses and money received this period, newest first.
function RecentCard({ data, cur, cal, isReceived, onOpen, onViewAll }) {
  const { theme, s } = useThemed();
  const rows = [
    ...(cur.expenses || []).map((e) => ({ kind: "expense", e, date: e.date || "", amount: -(e.amount || 0),
      cat: findCategory(data.categories || [], e.category) || UNCATEGORIZED })),
    ...(cur.credits || []).filter(isReceived).map((c) => ({ kind: c.dayOfMonth != null ? "creditRecurring" : "credit", e: c, amount: c.amount || 0,
      date: c.date || "", cat: findCategory(data.creditCategories || [], c.category || c.source) || CREDIT_UNCATEGORIZED })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const monthly = cal.calendarMonths;

  return (
    <article style={{ ...s.card, borderRadius: 28, minHeight: 300 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h2 style={{ ...s.cardTitle, margin: 0 }}>{t("Recent transactions")}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: theme.textFaint }}>{monthly ? t("Latest activity this month") : t("Latest activity this period")}</p>
        </div>
        <button style={{ ...s.linkBtn, display: "flex", alignItems: "center", gap: 5 }} onClick={onViewAll}>{t("View all →").replace(/\s*→$/, "")} <Icon name="chevron" size={14} /></button>
      </div>
      {rows.length === 0 && <div style={s.emptySmall}>{t("Nothing recorded yet.")}</div>}
      {rows.map((r) => (
        <button key={`${r.kind}-${r.e.id}`} className="row-hover" onClick={() => onOpen(r)}
          style={{ width: "100%", minHeight: 60, display: "grid", gridTemplateColumns: "38px minmax(0, 1fr) auto 14px", alignItems: "center", gap: 12,
                   borderWidth: "1px 0 0", borderStyle: "solid", borderColor: theme.border, background: "transparent", padding: "9px 4px", textAlign: "left", cursor: "pointer", color: theme.text, borderRadius: 0 }}>
          <span style={{ width: 36, height: 36, display: "grid", placeItems: "center", borderRadius: 13, background: `${r.cat.color}24`, fontSize: 16 }}>{r.cat.icon}</span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: "block", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.e.name}</strong>
            <span style={{ display: "block", marginTop: 3, fontSize: 12, color: theme.textFaint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {catName(r.cat.name)}{r.date ? ` · ${shortDay(r.date)}` : ""}
            </span>
          </span>
          <strong style={{ ...money, fontSize: 13, color: r.amount > 0 ? theme.success : theme.text }}>{r.amount > 0 ? "+" : "−"}{fmt(Math.abs(r.amount))}</strong>
          <span style={{ color: theme.textSoft, display: "flex" }}><Icon name="chevron" size={15} /></span>
        </button>
      ))}
    </article>
  );
}

export function Dashboard(props) {
  const {
    data, cur, curKey, today, cal, fc, remaining, remainingSub, totalUpcoming, totalActuallySpent, goals, goalsSaved, goalsTarget,
    dueBills, totalCredits, totalCreditsPending, savingsGoal, savingsShortfall, savingsTarget, leftToSpend, goalsNeed, effectiveIncome,
    totalStillScheduled, spentByCat, isReceived, onSetTab, onEdit, patchCur, save, onManageCategories, onSetBudget, onStartFresh,
  } = props;
  const { theme, s } = useThemed();
  const topRef = useRef(null);
  const lowerRef = useRef(null);
  useReflowAnimation(topRef);
  useReflowAnimation(lowerRef);

  const goalsLine = goals.length > 0 ? {
    saved: fmt(goalsSaved),
    sub: goalsTarget > 0
      ? `${t("{pct}% of {amount}", { pct: Math.round(Math.min(1, goalsSaved / goalsTarget) * 100), amount: fmt(goalsTarget) })} · ${tn(goals.length, "{n} goal", "{n} goals")}`
      : tn(goals.length, "{n} goal", "{n} goals"),
  } : null;

  return (
    <>
      {dueBills.length > 0 && (
        <div style={{ ...s.card, borderRadius: 20, padding: "12px 18px", marginBottom: 18, display: "flex", alignItems: "center", gap: SPACE.md, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: theme.warning, fontWeight: 700, fontSize: 13 }}>
            <Icon name="bell" size={16} />{t("Due soon")}
          </span>
          {dueBills.slice(0, 3).map((b) => (
            <span key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 10px", borderRadius: 10, background: theme.bg }}>
              <strong style={{ fontWeight: 600 }}>{b.name}</strong>
              <span style={{ color: b.inDays < 0 ? theme.danger : theme.textFaint }}>{due(b.inDays)}</span>
              <strong style={{ ...money, color: theme.warning }}>{fmt(b.amount)}</strong>
            </span>
          ))}
          {dueBills.length > 3 && <span style={{ fontSize: 12, color: theme.textFaint }}>{t("+{n} more", { n: dueBills.length - 3 })}</span>}
          <button style={{ ...s.linkBtn, marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, padding: 0 }} onClick={() => onSetTab("upcoming")}>
            {t("View all →").replace(/\s*→$/, "")} <Icon name="chevron" size={14} />
          </button>
        </div>
      )}

      <section className="dash-top" ref={topRef}>
        <MoneyLeftCard data={data} curKey={curKey} today={today} cal={cal} fc={fc} remaining={remaining} sub={remainingSub}
          stillToPay={totalUpcoming} goalsLine={goalsLine} />
        <SpendingCard data={data} curKey={curKey} today={today} cal={cal} spent={totalActuallySpent}
          effectiveIncome={effectiveIncome} spentByCat={spentByCat} onReports={() => onSetTab("reports")} />
      </section>

      <section className="dash-lower" ref={lowerRef}>
        <RecentCard data={data} cur={cur} cal={cal} isReceived={isReceived}
          onOpen={(r) => onEdit({ type: r.kind, editId: r.e.id })} onViewAll={() => onSetTab("expenses")} />
        <article style={{ ...s.card, borderRadius: 28, minHeight: 300 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ ...s.cardTitle, margin: 0 }}>{t("Category Budgets")}</h2>
            <button style={{ ...s.linkBtn, padding: 0 }} onClick={onManageCategories}>{t("Manage")}</button>
          </div>
          <div style={{ marginTop: 8 }}>
            <CategoryBudgets
              categories={data.categories}
              spent={spentByCat}
              average={(name) => categoryAverage(data, name, curKey, today)}
              envelopeOf={(c, sp) => envelope(data, c, curKey, today, sp)}
              onSetBudget={onSetBudget}
              onStartFresh={onStartFresh}
              compact
            />
          </div>
        </article>
      </section>

      {/* This period's income, what to set aside, and where it is going */}
      <div style={{ ...s.card, borderRadius: 28, marginTop: 18 }}>
        <div className="dash-plan">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={s.cardTitle}>{cal.calendarMonths ? t("Income this month") : t("Income this period")}</div>
              <InfoHint text={t("Your pay for this period. A new period starts with the last one's figure, so change it here when your pay changes. Credits are added on top.")} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <input type="number" min={0} value={cur.income || ""} placeholder="0" aria-label={t("Income this period")}
                onChange={(e) => patchCur({ income: Math.max(0, +e.target.value || 0) })}
                style={{ ...s.input, width: 130, textAlign: "right", ...money, fontWeight: 700, fontSize: 18, color: theme.success }} />
              <span style={{ ...TYPE.caption, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
            </div>
            {(totalCredits > 0 || totalCreditsPending > 0) && (
              <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.success, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>
                {t("+ {amount} credits", { amount: fmt(totalCredits) })}
                {totalCreditsPending > 0 && <span style={{ color: theme.textFaint }}> · {t("{amount} pending", { amount: fmt(totalCreditsPending) })}</span>}
              </div>
            )}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={s.cardTitle}>{cal.calendarMonths ? t("Set aside each month") : t("Set aside each period")}</div>
              <InfoHint text={t("How much you mean to save out of this period's money. It is taken off before Left to Spend, so what remains is genuinely free.")} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <input type="number" min={0} value={savingsGoal.monthly || ""} placeholder="0"
                onChange={(e) => save({ ...data, savingsGoal: { ...savingsGoal, monthly: Math.max(0, Math.floor(+e.target.value) || 0) } })}
                style={{ ...s.input, width: 140, textAlign: "right", ...money, fontWeight: 700, fontSize: 18 }} />
              <span style={{ ...TYPE.caption, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
            </div>
            {savingsShortfall > 0 ? (
              <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.warning, marginTop: 8 }}>
                {t("{short} short this period · setting aside {amount}", { short: fmt(savingsShortfall), amount: fmt(savingsTarget) })}
              </div>
            ) : savingsGoal.monthly > 0 ? (
              <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: 8 }}>
                {t("Covered · {amount} still free", { amount: fmt(leftToSpend) })}
              </div>
            ) : null}
            {goalsNeed > 0 && Math.round(goalsNeed) !== savingsGoal.monthly && (
              <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: 8 }}>
                {t("Your dated goals need {amount} a month.", { amount: fmt(goalsNeed) })}{" "}
                <button style={{ ...s.linkBtn, padding: 0, ...TYPE.finePrint, fontWeight: 600 }}
                  onClick={() => save({ ...data, savingsGoal: { ...savingsGoal, monthly: Math.round(goalsNeed) } })}>{t("Set aside that")}</button>
              </div>
            )}
          </div>
          <div>
            <div style={s.cardTitle}>{t("Income Breakdown")}</div>
            {effectiveIncome > 0 ? (
              <>
                <div style={{ ...s.breakdownBar, gap: 3, background: "transparent" }}>
                  {[
                    { pct: (totalActuallySpent / effectiveIncome) * 100, color: theme.danger },
                    { pct: (totalStillScheduled / effectiveIncome) * 100, color: theme.warning },
                    { pct: (savingsTarget / effectiveIncome) * 100, color: theme.accent },
                    { pct: (leftToSpend / effectiveIncome) * 100, color: theme.success },
                  ].filter((x) => x.pct > 0 && isFinite(x.pct)).map((seg, i) => (
                    <div key={i} style={{ height: "100%", borderRadius: 99, background: seg.color, width: `${Math.min(seg.pct, 100)}%`, transition: "width .3s" }} />
                  ))}
                </div>
                <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap" }}>
                  {[
                    { color: theme.danger, label: tk("Spent"), val: totalActuallySpent },
                    { color: theme.warning, label: tk("Upcoming"), val: totalStillScheduled },
                    { color: theme.accent, label: tk("Savings"), val: savingsTarget },
                    { color: theme.success, label: tk("Left to spend"), val: leftToSpend },
                  ].map((l) => (
                    <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: l.color }} />
                      <span style={{ color: theme.textFaint }}>{t(l.label)}</span>
                      <span style={{ ...money, fontWeight: 600, color: theme.text }}>{fmt(l.val)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={s.emptySmall}>{t("Set income to see breakdown")}</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
