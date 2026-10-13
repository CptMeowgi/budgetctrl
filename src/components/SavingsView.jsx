import { useState } from "react";
import { latestBalance, daysBetweenISO } from "../lib/accounts.js";
import { goalAccount, goalAccountOptions, goalStatus } from "../lib/goals.js";
import { parseAmount } from "../lib/importer.js";
import { monthLabel, isoDay } from "../lib/periods.js";
import { currencyCode, fmt } from "../money.js";
import { FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { SavingsChart } from "./charts.jsx";
import { GoalProgress, InfoHint, InlineNumber, TableHeader } from "./controls.jsx";
import { Modal } from "./Modal.jsx";
import { fmtDate, t, tn } from "../i18n.js";

const money = { fontFamily: FONT, fontVariantNumeric: "tabular-nums" };

// One sentence on where a goal stands: done, late, what it needs a month to
// land on its date, or when it gets there at the current pace.
function planLine(goal, st) {
  if (st.saved == null) return null;
  if (st.target <= 0) return t("No target set");
  if (st.reached) return t("Goal reached");
  if (st.overdue) return t("Was due {month} · {amount} still to go", { month: monthLabel(goal.targetDate), amount: fmt(st.remaining) });
  if (st.neededPerMonth != null) {
    const needed = t("{amount} a month gets you there by {month}", { amount: fmt(st.neededPerMonth), month: monthLabel(goal.targetDate) });
    return st.behind ? `${needed} · ${t("at your current pace, {month}", { month: monthLabel(st.eta) })}` : needed;
  }
  if (st.eta) return t("At your current pace ({amount} a month), {month}", { amount: fmt(st.pace), month: monthLabel(st.eta) });
  return t("{amount} to go", { amount: fmt(st.remaining) });
}

function sourceLine(goal, data, todayIso) {
  if (goal.source === "budget") {
    return goal.startAmount
      ? t("Counts what your budget leaves over each month, plus {amount} saved before", { amount: fmt(goal.startAmount) })
      : t("Counts what your budget leaves over each month");
  }
  const acc = goalAccount(goal, data);
  if (!acc) return t("Its account was removed. Edit the goal to choose another.");
  const last = latestBalance(acc);
  if (!last) return t("Tracks {name} · no balance entered yet", { name: acc.name });
  const days = daysBetweenISO(last.date, todayIso);
  const when = days <= 0 ? t("today") : days === 1 ? t("yesterday") : tn(days, "{n} day ago", "{n} days ago");
  return t("Tracks {name} · balance from {when}", { name: acc.name, when });
}

function GoalCard({ goal, status, data, todayIso, onEdit }) {
  const { theme, s } = useThemed();
  const plan = planLine(goal, status);
  const warn = status.overdue || status.behind;
  return (
    <div style={s.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: SPACE.sm }}>
        <div style={{ ...TYPE.bodyStrong, fontWeight: 600, color: theme.text }}>{goal.name}</div>
        <button style={s.editBtn} onClick={onEdit} title={t("Edit goal")}>✎</button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.xs, margin: `${SPACE.sm}px 0 ${SPACE.sm}px`, flexWrap: "wrap" }}>
        <span style={{ ...money, fontSize: 26, fontWeight: 700, color: status.reached ? theme.success : theme.text }}>
          {status.saved == null ? "—" : fmt(status.saved)}
        </span>
        {status.target > 0 && <span style={{ ...money, ...TYPE.caption, color: theme.textMuted }}>{t("of {amount}", { amount: fmt(status.target) })}</span>}
        {status.pct != null && (
          <span style={{ ...TYPE.caption, fontWeight: 600, marginLeft: "auto", color: status.reached ? theme.success : theme.textMuted }}>
            {Math.round(status.pct * 100)}%
          </span>
        )}
      </div>
      {status.target > 0 && status.saved != null && <GoalProgress saved={status.saved} target={status.target} />}
      {plan && (
        <div style={{ ...TYPE.caption, color: status.reached ? theme.success : warn ? theme.warning : theme.textMuted, marginTop: SPACE.sm, lineHeight: 1.45 }}>
          {plan}
        </div>
      )}
      <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: SPACE.xs, lineHeight: 1.45 }}>
        {sourceLine(goal, data, todayIso)}
      </div>
    </div>
  );
}

export function SavingsView({ data, history, today, cal, onAddGoal, onEditGoal, onChangeIncome, onOpenPeriod }) {
  const { theme, s } = useThemed();
  const goals = data.goals || [];
  const todayIso = isoDay(today);

  return (
    <>
      {goals.length === 0 ? (
        <div style={{ ...s.card, textAlign: "center", padding: SPACE.xxl }}>
          <div style={{ ...TYPE.lead, fontWeight: 600, marginBottom: SPACE.xs }}>{t("Save toward something")}</div>
          <div style={{ ...TYPE.caption, color: theme.textMuted, maxWidth: 460, margin: "0 auto", lineHeight: 1.5 }}>{t("A holiday, an emergency fund, a new car. Give it a target and a date, and see what it needs each month and when you'll get there at your current pace.")}</div>
          <button style={{ ...s.addBtn, marginTop: SPACE.lg }} onClick={onAddGoal}>{t("+ Add goal")}</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} status={goalStatus(g, data, today, history)} data={data} todayIso={todayIso}
              onEdit={() => onEditGoal(g)} />
          ))}
        </div>
      )}

      <div style={{ ...s.card, marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={s.cardTitle}>{t("Left over each month")}</div>
          <InfoHint text={t("Income less spending for every finished month, and the running total. A goal set to count what your budget leaves over uses this.")} />
        </div>
        <SavingsChart series={history.series} />
      </div>

      <div style={{ ...s.card, marginTop: 16 }}>
        <div style={s.cardTitle}>{t("Month by month")}</div>
        {history.series.length < 2 ? (
          <div style={s.emptySmall}>{t("Each month appears here once it has finished.")}</div>
        ) : (
          <>
            <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: SPACE.xs }}>{t("Income is editable here. For expenses, open the month.")}</div>
            <TableHeader columns={[
              { label: t("PERIOD"), flex: 2 }, { label: t("INCOME"), flex: 1, align: "right" },
              { label: t("SPENT"), flex: 1, align: "right" }, { label: t("LEFT OVER"), flex: 1, align: "right" },
              { label: t("RUNNING TOTAL"), flex: 1, align: "right" }, { label: "", flex: 0.8, align: "right" },
            ]} />
            {history.series.slice(1).map((row) => (
              <div key={row.key} style={s.tableRow}>
                <div style={{ flex: 2, fontWeight: 600, display: "flex", alignItems: "center", gap: SPACE.xs }}>
                  {cal.label(row.key).primary}
                  {row.editedAt && (
                    <span
                      title={t("Edited after this period closed, on {date}", { date: fmtDate(new Date(row.editedAt)) })}
                      style={{ ...TYPE.microLegal, color: theme.textFaint, border: `1px solid ${theme.border}`, borderRadius: RADIUS.pill, padding: "1px 7px", fontWeight: 400 }}
                    >{t("edited")}</span>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <InlineNumber value={data.months[row.key]?.income || 0} title={t("Base income for this period")}
                    onChange={(v) => onChangeIncome(row.key, v)} />
                </div>
                <div style={{ flex: 1, textAlign: "right", ...money, color: theme.textMuted }}>{fmt(row.spent)}</div>
                <div style={{ flex: 1, textAlign: "right", ...money, fontWeight: 700, color: row.delta >= 0 ? theme.success : theme.danger }}>
                  {row.delta >= 0 ? "+" : ""}{fmt(row.delta)}
                </div>
                <div style={{ flex: 1, textAlign: "right", ...money, fontWeight: 700 }}>{fmt(row.balance)}</div>
                <div style={{ flex: 0.8, textAlign: "right" }}>
                  <button style={{ ...s.linkBtn, padding: 0 }} title={t("Open this period to edit its expenses, recurring items and credits")}
                    onClick={() => onOpenPeriod(row.key)}>{t("Open →")}</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

export function GoalModal({ goal, data, curKey, onDismiss, onSave, onDelete }) {
  const { theme, s } = useThemed();
  const editing = !!goal;
  const options = goalAccountOptions(data.accounts, data.goals, goal?.id);
  const initialSource = goal
    ? (goal.source === "budget" ? "budget" : `account:${goal.accountId}`)
    : (options[0] ? `account:${options[0].id}` : "budget");
  const [name, setName] = useState(goal?.name || "");
  const [target, setTarget] = useState(goal?.target ? String(goal.target) : "");
  const [by, setBy] = useState(goal?.targetDate || "");
  const [source, setSource] = useState(initialSource);
  const [start, setStart] = useState(goal?.startAmount ? String(goal.startAmount) : "");
  const [armDelete, setArmDelete] = useState(false);

  const targetNum = target.trim() === "" ? 0 : parseAmount(target);
  const startNum = start.trim() === "" ? 0 : parseAmount(start);
  // An account picked before it was closed or deleted stays selectable, so
  // editing the name does not silently move the goal elsewhere.
  const currentMissing = goal?.source === "account" && !options.some((a) => a.id === goal.accountId);
  const valid = !!name.trim() && targetNum != null && targetNum >= 0 && (source !== "budget" || startNum != null);
  const label = { fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 };

  const submit = () => {
    if (!valid) return;
    const out = { name: name.trim(), target: Math.round(targetNum * 100) / 100 };
    if (by) out.targetDate = by;
    if (source === "budget") { out.source = "budget"; if (startNum) out.startAmount = startNum; }
    else { out.source = "account"; out.accountId = source.slice("account:".length); }
    onSave(out);
  };

  return (
    <Modal title={editing ? t("Edit Goal") : t("Add Goal")} onClose={onDismiss}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "20px 0 12px" }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={label}>{t("Name")}</label>
          <input autoFocus value={name} placeholder={t("e.g. Holiday in Portugal")} onChange={(e) => setName(e.target.value)} style={s.input} />
        </div>
        <div>
          <label style={label}>{t("Target ({currency})", { currency: currencyCode() })}</label>
          <input inputMode="decimal" value={target} placeholder="0" onChange={(e) => setTarget(e.target.value)} style={s.input} />
        </div>
        <div>
          <label style={label}>{t("By (optional)")}</label>
          <input type="month" value={by} min={curKey} onChange={(e) => setBy(e.target.value)} style={s.input} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={label}>{t("Counts")}</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} style={s.input}>
            {options.map((a) => <option key={a.id} value={`account:${a.id}`}>{t("The balance of {name}", { name: a.name })}</option>)}
            {currentMissing && <option value={`account:${goal.accountId}`}>{t("Its old account (removed)")}</option>}
            <option value="budget">{t("What my budget leaves over each month")}</option>
          </select>
          {options.length === 0 && !currentMissing && (
            <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: 6 }}>{t("Keeping the money in a savings account? Add it on the Accounts tab and this goal can track its balance.")}</div>
          )}
        </div>
        {source === "budget" && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={label}>{t("Already saved before ({currency}, optional)", { currency: currencyCode() })}</label>
            <input inputMode="decimal" value={start} placeholder="0" onChange={(e) => setStart(e.target.value)} style={s.input} />
          </div>
        )}
      </div>
      <button style={{ ...s.saveBtn, opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "not-allowed" }} disabled={!valid} onClick={submit}>
        {valid ? t("Save") : t("Fill in a name and a target")}
      </button>
      {editing && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: SPACE.md }}>
          <button style={{ ...s.linkBtn, color: theme.danger }} onClick={() => (armDelete ? onDelete() : setArmDelete(true))}>
            {armDelete ? t("Click again to delete this goal") : t("Delete goal")}
          </button>
        </div>
      )}
    </Modal>
  );
}
