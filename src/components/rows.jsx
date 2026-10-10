import { useContext } from "react";
import { periodLabel } from "../lib/periods.js";
import { upcomingSettled } from "../lib/reminders.js";
import { frequencyLabel, nextOnCycle } from "../lib/schedule.js";
import { DeleteArmContext } from "../contexts.js";
import { fmt } from "../money.js";
import { FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { CategoryPill } from "./controls.jsx";

// The trailing edit/delete cell on every entry row. Previously eight
// near-identical copies. onDelete stays a callback because the action really
// does differ per row - deleting a recurring item also drops its template.
export function RowActions({ id, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  const { armedId, arm } = useContext(DeleteArmContext);
  const armed = armedId === id;
  return (
    <div style={{ flex: 0.6, textAlign: "center", display: "flex", justifyContent: "center", gap: SPACE.xxs }}>
      <button style={s.editBtn} onClick={onEdit} title="Edit">✎</button>
      <button
        style={{ ...s.delBtn, color: armed ? theme.danger : theme.textFaint, fontWeight: armed ? 700 : 400 }}
        title={armed ? "Click again to confirm" : "Delete"}
        onClick={() => { if (armed) { onDelete(); arm(null); } else arm(id); }}
      >✕</button>
    </div>
  );
}

// Name cell shared by every entry row: the name, any badge passed as children,
// and the note on a second line. The note is clipped to one line so a long one
// never changes row height; the full text is on hover.
export function EntryName({ name, note, strike, every, children }) {
  const { theme } = useThemed();
  return (
    <div style={{ flex: 2, minWidth: 0 }}>
      <div style={{ fontWeight: 600, textDecoration: strike ? "line-through" : "none" }}>
        {name}
        {(every || 1) > 1 && (
          <span style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>{frequencyLabel(every).toLowerCase()}</span>
        )}
        {children}
      </div>
      {note && (
        <div title={note} style={{ ...TYPE.finePrint, lineHeight: 1.4, color: theme.textFaint, marginTop: 2,
                                   overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note}</div>
      )}
    </div>
  );
}

// Recurring bills or credits that exist in the template but fall in a later
// period. Without this they would vanish from view entirely between occurrences
// - a yearly bill set up in October would be invisible until March.
export function NotDueThisPeriod({ items, curKey, cutoffDay, categories, fallback, positive, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  if (!items.length) return null;
  return (
    <div style={{ marginTop: SPACE.lg }}>
      <div style={{ ...s.cardTitle, marginBottom: SPACE.xxs }}>Not due this period</div>
      {items.map((tpl) => (
        <div key={tpl.id} style={{ ...s.tableRow, opacity: 0.8 }}>
          <EntryName name={tpl.name} note={tpl.note} />
          <div style={{ flex: 1.2 }}><CategoryPill categoryName={tpl.category} categories={categories} fallback={fallback} /></div>
          <div style={{ flex: 1.5, color: theme.textMuted, ...TYPE.caption }}>
            {frequencyLabel(tpl.every)} · next {periodLabel(nextOnCycle(tpl, curKey), cutoffDay).primary}
          </div>
          <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700,
                        color: positive ? theme.success : theme.accent }}>{positive ? "+" : ""}{fmt(tpl.amount)}</div>
          <RowActions id={`tpl-${tpl.id}`} onEdit={() => onEdit(tpl)} onDelete={() => onDelete(tpl)} />
        </div>
      ))}
    </div>
  );
}

// One row definition per entry type, used by the live tab and by History. They
// were duplicated character-for-character apart from which period the edit and
// delete callbacks targeted, so that is all the caller supplies.
export function ExpenseRow({ entry: e, categories, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  return (
    <div style={s.tableRow}>
      <EntryName name={e.name} note={e.note} />
      <div style={{ flex: 1.2 }}><CategoryPill categoryName={e.category} categories={categories} /></div>
      <div style={{ flex: 1, color: theme.textMuted, ...TYPE.caption }}>{e.date}</div>
      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.danger }}>{fmt(e.amount)}</div>
      <RowActions id={e.id} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

export function RecurringRow({ entry: r, categories, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  return (
    <div style={s.tableRow}>
      <EntryName name={r.name} note={r.note} every={r.every}>
        {r.autoPay && <span title="Pays itself" style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>auto</span>}
      </EntryName>
      <div style={{ flex: 1.2 }}><CategoryPill categoryName={r.category} categories={categories} /></div>
      <div style={{ flex: 0.5, textAlign: "center", color: theme.textMuted, ...TYPE.caption }}>{r.dayOfMonth || "—"}</div>
      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.accent }}>{fmt(r.amount)}</div>
      <RowActions id={r.id} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

export function UpcomingRow({ entry: u, categories, today, onTogglePaid, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  const settled = upcomingSettled(u, today);
  return (
    <div style={{ ...s.tableRow, opacity: settled ? 0.4 : 1 }}>
      <div style={{ flex: 0.3 }}>
        <input type="checkbox" checked={settled} onChange={onTogglePaid} disabled={!!u.autoPay}
          title={u.autoPay ? "Pays itself - settles on its due date" : undefined}
          style={{ accentColor: theme.success, width: 16, height: 16, cursor: u.autoPay ? "default" : "pointer" }} />
      </div>
      <EntryName name={u.name} note={u.note} strike={settled}>
        {u.autoPay && <span title="Pays itself" style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>auto</span>}
      </EntryName>
      <div style={{ flex: 1.2 }}><CategoryPill categoryName={u.category} categories={categories} /></div>
      <div style={{ flex: 1, color: theme.textMuted, ...TYPE.caption }}>{u.dueDate}</div>
      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: settled ? theme.success : theme.warning }}>{fmt(u.amount)}</div>
      <div style={{ flex: 0.7, textAlign: "center" }}>
        <span style={{ ...TYPE.microLegal, padding: "3px 10px", borderRadius: RADIUS.pill, fontWeight: 600,
          background: settled ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
          color: settled ? theme.success : theme.warning }}>{settled ? "Paid" : "Pending"}</span>
      </div>
      <RowActions id={u.id} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

// Recovery for a period created before the rollover fix landed, or one whose
// entries were deleted by accident: the template still knows what belongs here.
export function MissingFromTemplate({ missing, noun, onAdd }) {
  const { theme, s } = useThemed();
  if (!missing.length) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap",
      background: theme.accentSoft, border: `1px solid ${theme.border}`,
      borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.sm,
    }}>
      <span style={{ ...TYPE.caption, color: theme.text }}>
        {missing.length} {noun}{missing.length !== 1 ? "s" : ""} from your template {missing.length !== 1 ? "are" : "is"} not in this period: {missing.map((x) => x.name).join(", ")}
      </span>
      <button style={{ ...s.linkBtn, padding: 0, marginLeft: "auto" }} onClick={onAdd}>
        Add {missing.length !== 1 ? "them" : "it"} →
      </button>
    </div>
  );
}
