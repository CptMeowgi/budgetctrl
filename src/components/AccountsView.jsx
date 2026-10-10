import { useState } from "react";
import { ACCOUNT_KINDS, daysBetweenISO, kindOf, latestBalance, netWorthAsOf, netWorthChange, netWorthSeries, previousBalance, sortedBalances, STALE_DAYS, staleAccounts } from "../lib/accounts.js";
import { parseAmount } from "../lib/importer.js";
import { currencyCode, fmt, fmtPlain } from "../money.js";
import { FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { NetWorthChart } from "./charts.jsx";
import { StatCard } from "./controls.jsx";
import { Modal } from "./Modal.jsx";

function dayLabel(iso, withYear = true) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", withYear
    ? { day: "numeric", month: "short", year: "numeric" }
    : { day: "numeric", month: "short" });
}

function updatedLabel(days, iso) {
  if (days <= 0) return "updated today";
  if (days === 1) return "updated yesterday";
  if (days < 60) return `updated ${days} days ago`;
  return `updated ${dayLabel(iso)}`;
}

// Balances are typed in, not derived: the quickest path is the point, so
// updating one is a single field on the row, Enter to save.
export function AccountsView({ accounts, todayISO, onAdd, onEdit, onRecord, onRemoveBalance }) {
  const { theme, s } = useThemed();
  const [updating, setUpdating] = useState(null);
  const [draft, setDraft] = useState({ amount: "", date: todayISO });
  const [expanded, setExpanded] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const money = { fontFamily: FONT, fontVariantNumeric: "tabular-nums" };
  const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  if (!accounts.length) {
    return (
      <div style={{ ...s.card, textAlign: "center", padding: SPACE.xxl }}>
        <div style={{ ...TYPE.lead, fontWeight: 600, marginBottom: SPACE.xs }}>Your accounts, in one place</div>
        <div style={{ ...TYPE.caption, color: theme.textMuted, maxWidth: 440, margin: "0 auto", lineHeight: 1.5 }}>
          Add your current account, savings, cash, cards and loans, and type in each balance when you check it.
          You'll see your net worth and how it moves over time.
        </div>
        <button style={{ ...s.addBtn, marginTop: SPACE.lg }} onClick={onAdd}>+ Add account</button>
      </div>
    );
  }

  const open = accounts.filter((a) => !a.closed);
  const assets = open.filter((a) => !kindOf(a).liability);
  const debts = open.filter((a) => kindOf(a).liability);
  const closed = accounts.filter((a) => a.closed);
  const worth = netWorthAsOf(accounts, todayISO);
  const change = netWorthChange(accounts, todayISO, 30);
  const stale = staleAccounts(accounts, todayISO);
  const series = netWorthSeries(accounts).map((p) => ({ ...p, label: dayLabel(p.date, false) }));

  const startUpdate = (a) => {
    const last = latestBalance(a);
    setUpdating(a.id);
    setDraft({ amount: last ? fmtPlain(last.amount) : "", date: todayISO });
  };
  const draftAmount = parseAmount(draft.amount);
  const commit = () => {
    if (draftAmount == null || !draft.date) return;
    onRecord(updating, { date: draft.date, amount: draftAmount });
    setUpdating(null);
  };

  const row = (a) => {
    const kind = kindOf(a);
    const last = latestBalance(a);
    const prev = previousBalance(a);
    const delta = last && prev ? last.amount - prev.amount : null;
    // Owing less is the good direction for a card or loan.
    const good = delta == null ? null : (kind.liability ? delta < 0 : delta > 0);
    const age = last ? daysBetweenISO(last.date, todayISO) : null;
    const isStale = !a.closed && (age == null || age > STALE_DAYS);
    const isUpdating = updating === a.id;
    const history = sortedBalances(a).reverse();
    return (
      <div key={a.id} style={{ borderBottom: `1px solid ${theme.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: SPACE.md, padding: "14px 0" }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: theme.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{kind.icon}</div>
          <button onClick={() => setExpanded(expanded === a.id ? null : a.id)} title="Show balance history"
            style={{ all: "unset", cursor: "pointer", flex: 1, minWidth: 0 }}>
            <div style={{ ...ellipsis, fontWeight: 600, color: a.closed ? theme.textMuted : theme.text }}>{a.name}</div>
            <div style={{ ...TYPE.finePrint, color: isStale ? theme.warning : theme.textFaint, marginTop: 2, ...ellipsis }}>
              {kind.label} · {a.closed ? "closed" : last ? updatedLabel(age, last.date) : "no balance yet"}
            </div>
          </button>
          {isUpdating ? (
            <div style={{ display: "flex", alignItems: "center", gap: SPACE.xs, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <input autoFocus inputMode="decimal" aria-label={kind.liability ? `Amount owed on ${a.name}` : `Balance of ${a.name}`}
                value={draft.amount} placeholder={kind.liability ? "Owed" : "Balance"}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { e.stopPropagation(); setUpdating(null); } }}
                style={{ ...s.input, width: 120, minHeight: 34, padding: "6px 10px", textAlign: "right" }} />
              <input type="date" aria-label="As of" value={draft.date} max={todayISO}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                style={{ ...s.input, width: 140, minHeight: 34, padding: "6px 10px" }} />
              <button style={{ ...s.editBtn, opacity: draftAmount == null ? 0.4 : 1 }} disabled={draftAmount == null} onClick={commit} title="Save (Enter)">✓</button>
              <button style={s.delBtn} onClick={() => setUpdating(null)} title="Cancel (Esc)">✕</button>
            </div>
          ) : (
            <>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ ...money, fontWeight: 700, color: kind.liability && last?.amount > 0 ? theme.danger : theme.text }}>
                  {last ? fmt(last.amount) : "—"}
                </div>
                {delta != null && delta !== 0 && (
                  <div style={{ ...TYPE.finePrint, ...money, color: good ? theme.success : theme.danger, marginTop: 2 }}
                    title={`Since ${dayLabel(prev.date)}`}>
                    {delta > 0 ? "↑" : "↓"} {fmt(Math.abs(delta))}
                  </div>
                )}
              </div>
              {!a.closed && <button style={s.linkBtn} onClick={() => startUpdate(a)}>Update</button>}
              <button style={s.editBtn} onClick={() => onEdit(a)} title="Edit account">✎</button>
            </>
          )}
        </div>
        {expanded === a.id && (
          <div style={{ padding: `0 0 ${SPACE.md}px 50px` }}>
            {history.length === 0 ? (
              <div style={{ ...TYPE.finePrint, color: theme.textFaint }}>No balances recorded.</div>
            ) : history.map((b, i) => {
              const older = history[i + 1];
              const d = older ? b.amount - older.amount : null;
              const up = d != null && (kind.liability ? d < 0 : d > 0);
              return (
                <div key={b.date} style={{ display: "flex", alignItems: "center", gap: SPACE.md, padding: "6px 0", ...TYPE.caption }}>
                  <div style={{ flex: 1, color: theme.textMuted }}>{dayLabel(b.date)}</div>
                  <div style={{ ...money, width: 110, textAlign: "right" }}>{fmt(b.amount)}</div>
                  <div style={{ ...money, width: 110, textAlign: "right", ...TYPE.finePrint, color: d == null || d === 0 ? theme.textFaint : up ? theme.success : theme.danger }}>
                    {d == null ? "first" : d === 0 ? "no change" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`}
                  </div>
                  <button style={s.delBtn} title="Remove this balance" onClick={() => onRemoveBalance(a.id, b.date)}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const group = (title, list, total) => list.length > 0 && (
    <div style={{ ...s.card, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={s.cardTitle}>{title}</div>
        <div style={{ ...TYPE.caption, ...money, fontWeight: 700, color: theme.textMuted }}>{fmt(total)}</div>
      </div>
      {list.map(row)}
    </div>
  );

  return (
    <>
      {stale.length > 0 && (
        <div style={{ ...TYPE.caption, background: `${theme.warning}18`, color: theme.text, border: `1px solid ${theme.warning}55`,
                      borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.md }}>
          {stale.map((a) => a.name).join(", ")} {stale.length === 1 ? "hasn't" : "haven't"} been updated in over a month.
        </div>
      )}
      <div style={s.statsRow}>
        <StatCard label="Net worth" value={fmt(worth.net)} accent={worth.net >= 0 ? "#10b981" : "#ef4444"}
          sub={change == null ? "What you own, less what you owe"
            : change === 0 ? "No change in 30 days"
            : `${change > 0 ? "↑" : "↓"} ${fmt(Math.abs(change))} in 30 days`} icon="¤" />
        <StatCard label="Assets" value={fmt(worth.assets)} accent="#0066cc"
          sub={`${assets.length} account${assets.length !== 1 ? "s" : ""}`} icon="↑" />
        <StatCard label="Debts" value={fmt(worth.debts)} accent="#ef4444"
          sub={debts.length ? `${debts.length} card${debts.length !== 1 ? "s" : ""} or loan${debts.length !== 1 ? "s" : ""}` : "None recorded"} icon="↓" />
      </div>

      <div style={s.card}>
        <div style={s.cardTitle}>Net worth over time</div>
        <NetWorthChart series={series} />
      </div>

      {group("Assets", assets, worth.assets)}
      {group("Debts · what you owe", debts, worth.debts)}

      {closed.length > 0 && (
        <div style={{ marginTop: SPACE.md }}>
          <button style={s.linkBtn} onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? "Hide" : "Show"} closed accounts ({closed.length})
          </button>
          {showClosed && <div style={{ ...s.card, marginTop: SPACE.sm }}>{closed.map(row)}</div>}
        </div>
      )}
    </>
  );
}

export function AccountModal({ account, todayISO, onDismiss, onSave, onSetClosed, onDelete }) {
  const { theme, s } = useThemed();
  const editing = !!account;
  const [name, setName] = useState(account?.name || "");
  const [kind, setKind] = useState(account?.kind || "current");
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(todayISO);
  const [armDelete, setArmDelete] = useState(false);
  const amount = parseAmount(balance);
  const liability = ACCOUNT_KINDS.find((k) => k.id === kind)?.liability;
  const valid = !!name.trim() && (editing || (amount != null && !!date));
  const label = { fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 };
  return (
    <Modal title={editing ? "Edit Account" : "Add Account"} onClose={onDismiss}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "20px 0 12px" }}>
        <div>
          <label style={label}>Name</label>
          <input autoFocus value={name} placeholder="e.g. Everyday account" onChange={(e) => setName(e.target.value)} style={s.input} />
        </div>
        <div>
          <label style={label}>Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={s.input}>
            {ACCOUNT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
          </select>
        </div>
        {!editing && (
          <>
            <div>
              <label style={label}>{liability ? `Amount owed (${currencyCode()})` : `Balance (${currencyCode()})`}</label>
              <input inputMode="decimal" value={balance} placeholder="0" onChange={(e) => setBalance(e.target.value)} style={s.input} />
            </div>
            <div>
              <label style={label}>As of</label>
              <input type="date" value={date} max={todayISO} onChange={(e) => setDate(e.target.value)} style={s.input} />
            </div>
          </>
        )}
      </div>
      {liability && !editing && (
        <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginBottom: SPACE.sm }}>
          Enter what you owe as a positive number. It's taken off your net worth.
        </div>
      )}
      <button style={{ ...s.saveBtn, opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "not-allowed" }} disabled={!valid}
        onClick={() => onSave({ name: name.trim(), kind, amount, date })}>
        {valid ? "Save" : editing ? "Fill in a name" : "Fill in a name and balance"}
      </button>
      {editing && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: SPACE.md }}>
          <button style={s.linkBtn} onClick={() => onSetClosed(!account.closed)}
            title={account.closed ? undefined : "Records a zero balance today and moves it to closed accounts. Its history is kept."}>
            {account.closed ? "Reopen account" : "Close account"}
          </button>
          <button style={{ ...s.linkBtn, color: theme.danger }} onClick={() => (armDelete ? onDelete() : setArmDelete(true))}>
            {armDelete ? "Click again to delete it and its history" : "Delete account"}
          </button>
        </div>
      )}
    </Modal>
  );
}
