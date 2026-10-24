import { useMemo, useState } from "react";
import { calendarFor } from "../lib/calendar.js";
import { checkUp } from "../lib/checkup.js";
import { fmt } from "../money.js";
import { catName, shortDate } from "../text.js";
import { SPACE, TYPE, useThemed } from "../theme.js";
import { Modal } from "./Modal.jsx";
import { t, tk, tn } from "../i18n.js";

// What each kind of finding means, and what to do about it.
const SECTIONS = {
  missingCategory: {
    title: tk("Filed under a category that no longer exists"),
    why: tk("No category budget counts these. Open each one and pick a category that exists."),
  },
  duplicate: {
    title: tk("Possible duplicates"),
    why: tk("The same date, amount and name as another entry, often from a statement imported twice. If it's the same payment, delete this one. Ctrl+Z brings it back."),
  },
  unpaidPast: {
    title: tk("Payments in past periods never marked paid"),
    why: tk("Mark each one paid if you paid it, or open it and delete it if you didn't."),
  },
  rolloverDeficit: {
    title: tk("Rollover budgets deep in the red"),
    why: tk("These bring more overspending into this period than a whole budget. Raise the budget, or start the rollover afresh, on the Dashboard."),
  },
  uncategorized: {
    title: tk("Spending without a category"),
    why: tk("Give these a category so a budget counts them."),
  },
};
const KIND = {
  expense: tk("Expense"), recurring: tk("Recurring"), upcoming: tk("Upcoming"), credit: tk("Credit"),
  recurringTemplate: tk("Recurring bill"), creditTemplate: tk("Recurring credit"), category: tk("Category budget"),
};
const SHOWN = 20;

// The check-up: anything in the budget that looks wrong, grouped by what it
// is, each with a way to open it. `onOpen` takes a finding; `onFix` applies
// the one fix some findings offer (delete a duplicate, mark a payment paid).
export function CheckupModal({ data, today, onOpen, onFix, onClose }) {
  const { theme, s } = useThemed();
  const cal = calendarFor(data);
  const findings = useMemo(() => checkUp(data, today), [data, today]);
  const [expanded, setExpanded] = useState({});
  const types = Object.keys(SECTIONS).filter((type) => findings.some((f) => f.type === type));
  const muted = { ...TYPE.finePrint, color: theme.textMuted, lineHeight: 1.5 };

  const detail = (f) => {
    const where = f.periodKey ? (cal.label(f.periodKey).range || cal.label(f.periodKey).primary) : t("every period");
    if (f.type === "missingCategory") return `${t(KIND[f.kind])} · ${where} · ${catName(f.category)}`;
    if (f.type === "rolloverDeficit") return t("{carry} carried in, against a budget of {cap}", { carry: fmt(f.carry), cap: fmt(f.cap) });
    const date = f.entry.date || f.entry.dueDate;
    const same = f.type === "duplicate" ? ` · ${t("same as {name}", { name: f.of.name })}` : "";
    return `${t(KIND[f.kind])} · ${date ? shortDate(date) : where}${same}`;
  };

  return (
    <Modal title={t("Check-up")} onClose={onClose} width={680}>
      {findings.length === 0 ? (
        <p style={{ ...TYPE.caption, color: theme.text, lineHeight: 1.6 }}>
          {t("Nothing looks wrong. Every entry has a category that exists, nothing looks entered twice, and past payments are settled.")}
        </p>
      ) : (
        <>
          <p style={{ ...muted, margin: `0 0 ${SPACE.md}px` }}>
            {tn(findings.length, "{n} thing might be wrong. Open it to put it right; nothing changes until you do.",
              "{n} things might be wrong. Open each one to put it right; nothing changes until you do.")}
          </p>
          <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
            {types.map((type) => {
              const list = findings.filter((f) => f.type === type);
              const shown = expanded[type] ? list : list.slice(0, SHOWN);
              return (
                <section key={type} style={{ marginBottom: SPACE.lg }}>
                  <h3 style={{ ...s.cardTitle, margin: 0 }}>{t(SECTIONS[type].title)} <span style={{ color: theme.textFaint, fontWeight: 500 }}>· {list.length}</span></h3>
                  <p style={{ ...muted, margin: `4px 0 ${SPACE.xs}px` }}>{t(SECTIONS[type].why)}</p>
                  {shown.map((f, i) => (
                    <div key={`${f.kind}-${f.entry.id || f.entry.name}-${f.periodKey}-${i}`}
                      style={{ display: "flex", alignItems: "center", gap: SPACE.sm, padding: "7px 0", borderBottom: `1px solid ${theme.border}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...TYPE.caption, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.kind === "category" ? catName(f.entry.name) : f.entry.name}</div>
                        <div style={{ ...TYPE.microLegal, color: theme.textFaint }}>{detail(f)}</div>
                      </div>
                      {f.kind !== "category" && (
                        <span style={{ ...TYPE.caption, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt(f.entry.amount || 0)}</span>
                      )}
                      {f.type === "duplicate" && (
                        <button style={{ ...s.linkBtn, padding: 0, color: theme.danger }} onClick={() => onFix(f)}>{t("Delete")}</button>
                      )}
                      {f.type === "unpaidPast" && (
                        <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => onFix(f)}>{t("Mark paid")}</button>
                      )}
                      <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => onOpen(f)}>{t("Open")}</button>
                    </div>
                  ))}
                  {list.length > shown.length && (
                    <button style={{ ...s.linkBtn, padding: 0, marginTop: SPACE.xs }} onClick={() => setExpanded({ ...expanded, [type]: true })}>
                      {t("Show {n} more", { n: list.length - shown.length })}
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
