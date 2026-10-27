import { useContext } from "react";
import { upcomingSettled } from "../lib/reminders.js";
import { repeatLabel } from "../lib/schedule.js";
import { isWeekly, nextPeriodOf } from "../lib/occurrences.js";
import { DeleteArmContext } from "../contexts.js";
import { fmt } from "../money.js";
import { FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { CategoryPill, SELECT_CELL } from "./controls.jsx";
import { isShared } from "../lib/people.js";
import { isSplit } from "../lib/splits.js";
import { t, tn } from "../i18n.js";
import { payerText, shortDate } from "../text.js";

// The trailing edit/delete cell on every entry row. Previously eight
// near-identical copies. onDelete stays a callback because the action really
// does differ per row - deleting a recurring item also drops its template.
export function RowActions({ id, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  const { armedId, arm } = useContext(DeleteArmContext);
  const armed = armedId === id;
  return (
    <div style={{ flex: 0.6, textAlign: "center", display: "flex", justifyContent: "center", gap: SPACE.xxs }}>
      <button style={s.editBtn} onClick={onEdit} title={t("Edit")}>✎</button>
      <button
        style={{ ...s.delBtn, color: armed ? theme.danger : theme.textFaint, fontWeight: armed ? 700 : 400 }}
        title={armed ? t("Click again to confirm") : t("Delete")}
        onClick={() => { if (armed) { onDelete(); arm(null); } else arm(id); }}
      >✕</button>
    </div>
  );
}

// Name cell shared by every entry row: the name, any badge passed as children,
// and the note on a second line. The note is clipped to one line so a long one
// never changes row height; the full text is on hover.
// `schedule` is the item, when it repeats: anything but a monthly repeat is
// named beside it, so a fortnightly bill reads "every 2 weeks".
export function EntryName({ name, note, strike, schedule, children }) {
  const { theme } = useThemed();
  return (
    <div style={{ flex: 2, minWidth: 0 }}>
      <div style={{ fontWeight: 600, textDecoration: strike ? "line-through" : "none" }}>
        {name}
        {schedule && repeatLabel(schedule) !== "Monthly" && (
          <span style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>{t(repeatLabel(schedule)).toLowerCase()}</span>
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

// Who paid an entry and with what, small beside its name: "Anna, Visa",
// "Joint" or "Anna". Nothing in a budget without two people, or when it
// isn't set.
export function PayerLabel({ data, entry }) {
  const { theme } = useThemed();
  if (!isShared(data)) return null;
  const text = payerText(data, entry);
  if (!text) return null;
  return <span style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>{text}</span>;
}

// Recurring bills or credits that exist in the template but fall in a later
// period. Without this they would vanish from view entirely between occurrences
// - a yearly bill set up in October would be invisible until March.
export function NotDueThisPeriod({ items, data, curKey, cal, categories, fallback, positive, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  if (!items.length) return null;
  return (
    <div style={{ marginTop: SPACE.lg }}>
      <div style={{ ...s.cardTitle, marginBottom: SPACE.xxs }}>{t("Not due this period")}</div>
      {items.map((tpl) => (
        <div key={tpl.id} style={{ ...s.tableRow, opacity: 0.8 }}>
          <EntryName name={tpl.name} note={tpl.note}><PayerLabel data={data} entry={tpl} /></EntryName>
          <div style={{ flex: 1.2 }}><CategoryPill categoryName={tpl.category} categories={categories} fallback={fallback} /></div>
          <div style={{ flex: 1.5, color: theme.textMuted, ...TYPE.caption }}>
            {t("{frequency} · next {period}", { frequency: t(repeatLabel(tpl)), period: cal.label(nextPeriodOf(tpl, cal, curKey)).primary })}
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
// A checkbox for a row while its list is being bulk edited (`selected` is
// true or false then, undefined otherwise).
export function SelectCell({ name, selected, onSelect }) {
  const { theme } = useThemed();
  if (selected === undefined) return null;
  return (
    <div style={{ width: SELECT_CELL, flexShrink: 0 }}>
      <input type="checkbox" checked={selected} onChange={onSelect} aria-label={t("Select {name}", { name })}
        style={{ accentColor: theme.accent, width: 16, height: 16, cursor: "pointer" }} />
    </div>
  );
}

export function ExpenseRow({ entry: e, data, categories, onEdit, onDelete, selected, onSelect }) {
  const { theme, s } = useThemed();
  return (
    <div style={s.tableRow}>
      <SelectCell name={e.name} selected={selected} onSelect={onSelect} />
      <EntryName name={e.name} note={e.note}><PayerLabel data={data} entry={e} /></EntryName>
      <div style={{ flex: 1.2 }}>
        {isSplit(e) ? (
          <span title={e.splits.map((p) => `${p.category}: ${fmt(p.amount)}`).join("\n")}
            style={{ ...s.catPill, background: theme.bg, color: theme.textMuted, cursor: "help" }}>
            <span style={{ ...s.catDot, background: theme.border }}>⑂</span>
            {t("Split · {n}", { n: e.splits.length })}
          </span>
        ) : <CategoryPill categoryName={e.category} categories={categories} />}
      </div>
      <div style={{ flex: 1, color: theme.textMuted, ...TYPE.caption }} title={e.date}>{shortDate(e.date)}</div>
      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.danger }}>{fmt(e.amount)}</div>
      <RowActions id={e.id} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

export function RecurringRow({ entry: r, data, categories, onEdit, onDelete, dated }) {
  const { theme, s } = useThemed();
  return (
    <div style={s.tableRow}>
      <EntryName name={r.name} note={r.note} schedule={r}>
        {r.autoPay && <span title={t("Pays itself")} style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>{t("auto")}</span>}
        <PayerLabel data={data} entry={r} />
      </EntryName>
      <div style={{ flex: 1.2 }}><CategoryPill categoryName={r.category} categories={categories} /></div>
      {/* In a fortnight every copy carries its date. */}
      <div style={{ flex: 0.5, textAlign: "center", color: theme.textMuted, ...TYPE.caption }}>{(isWeekly(r) || dated) && r.date ? shortDate(r.date) : (r.dayOfMonth || "—")}</div>
      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.accent }}>{fmt(r.amount)}</div>
      <RowActions id={r.id} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

export function UpcomingRow({ entry: u, data, categories, today, onTogglePaid, onEdit, onDelete }) {
  const { theme, s } = useThemed();
  const settled = upcomingSettled(u, today);
  return (
    <div style={{ ...s.tableRow, opacity: settled ? 0.4 : 1 }}>
      <div style={{ flex: 0.3 }}>
        <input type="checkbox" checked={settled} onChange={onTogglePaid} disabled={!!u.autoPay}
          title={u.autoPay ? t("Pays itself - settles on its due date") : undefined}
          style={{ accentColor: theme.success, width: 16, height: 16, cursor: u.autoPay ? "default" : "pointer" }} />
      </div>
      <EntryName name={u.name} note={u.note} strike={settled}>
        {u.autoPay && <span title={t("Pays itself")} style={{ ...TYPE.microLegal, color: theme.textFaint, marginLeft: 6 }}>{t("auto")}</span>}
        <PayerLabel data={data} entry={u} />
      </EntryName>
      <div style={{ flex: 1.2 }}><CategoryPill categoryName={u.category} categories={categories} /></div>
      <div style={{ flex: 1, color: theme.textMuted, ...TYPE.caption }} title={u.dueDate}>{shortDate(u.dueDate)}</div>
      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: settled ? theme.success : theme.warning }}>{fmt(u.amount)}</div>
      <div style={{ flex: 0.7, textAlign: "center" }}>
        <span style={{ ...TYPE.microLegal, padding: "3px 10px", borderRadius: RADIUS.pill, fontWeight: 600,
          background: settled ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
          color: settled ? theme.success : theme.warning }}>{settled ? t("Paid") : t("Pending")}</span>
      </div>
      <RowActions id={u.id} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

// Recovery for a period created before the rollover fix landed, or one whose
// entries were deleted by accident: the template still knows what belongs here.
export function MissingFromTemplate({ missing, kind, onAdd }) {
  const { theme, s } = useThemed();
  if (!missing.length) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap",
      background: theme.accentSoft, border: `1px solid ${theme.border}`,
      borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.sm,
    }}>
      <span style={{ ...TYPE.caption, color: theme.text }}>
        {kind === "credit"
          ? tn(missing.length, "{n} recurring credit isn't in this period yet: {names}", "{n} recurring credits aren't in this period yet: {names}", { names: missing.map((x) => x.name).join(", ") })
          : tn(missing.length, "{n} recurring bill isn't in this period yet: {names}", "{n} recurring bills aren't in this period yet: {names}", { names: missing.map((x) => x.name).join(", ") })}
      </span>
      <button style={{ ...s.linkBtn, padding: 0, marginLeft: "auto" }} onClick={onAdd}>
        {tn(missing.length, "Add it →", "Add them →")}
      </button>
    </div>
  );
}
