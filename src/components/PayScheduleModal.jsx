import { useState } from "react";
import { calendarFor } from "../lib/calendar.js";
import { parseAmount } from "../lib/importer.js";
import { defaultFirstPayday, PAY_KINDS, switchSchedule } from "../lib/paySchedule.js";
import { isoDay } from "../lib/periods.js";
import { fmt } from "../money.js";
import { catName, ordinal } from "../text.js";
import { TYPE, useThemed } from "../theme.js";
import { Modal } from "./Modal.jsx";
import { fmtDate, t, tn } from "../i18n.js";

// Changing how you're paid. Nothing changes until "Switch": every input
// recomputes the preview from switchSchedule, the same function that makes
// the change, so what it shows is what happens.
export function PayScheduleModal({ data, today, initialKind, initialCutoff, onCancel, onSwitch }) {
  const { theme, s } = useThemed();
  const cal = calendarFor(data);
  const curKey = cal.current(today);
  const [kind] = useState(initialKind);
  const weekly = kind !== "monthly";
  const [nextPayday, setNextPayday] = useState(() => defaultFirstPayday(data, today));
  const [cutoffDay, setCutoffDay] = useState(initialCutoff || data.cutoffDay || 1);
  const options = weekly
    ? { kind: "weeks", every: Number(kind.split(":")[1]), firstPayday: nextPayday }
    : { kind: "monthly", cutoffDay };
  // The suggested paycheck, until the reader types their own.
  const [paycheckText, setPaycheckText] = useState(() => String(switchSchedule(data, options, today).preview.paycheck ?? ""));
  const paycheck = parseAmount(paycheckText);
  const paycheckOk = paycheck != null && paycheck >= 0;
  const { data: next, preview } = switchSchedule(data, { ...options, ...(paycheckOk ? { paycheck } : {}) }, today);
  // No new period starts when nothing changes or a switch is taken back, so
  // there is no paycheck to ask for.
  const asksPaycheck = !preview.unchanged && !preview.takeBack;
  const canSwitch = !preview.error && !preview.unchanged && (paycheckOk || !asksPaycheck);

  const label = { ...TYPE.finePrint, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 };
  const line = { ...TYPE.caption, color: theme.text, lineHeight: 1.5, margin: "0 0 8px" };
  const cell = { ...TYPE.caption, padding: "6px 8px", textAlign: "right" };
  const curLabel = cal.label(curKey);
  const range = curLabel.range || curLabel.primary;
  const endDate = !preview.error && fmtDate(preview.current.end, { day: "numeric", month: "long" });
  const payDate = fmtDate(preview.firstPayday, { day: "numeric", month: "long" });

  return (
    <Modal title={t("Change how you're paid")} onClose={onCancel} width={560}>
      <div style={{ ...TYPE.caption, fontWeight: 700, margin: "12px 0 16px" }}>{t(PAY_KINDS.find((k) => k.id === kind)?.label || "")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        {weekly ? (
          <div>
            <label style={label}>{t("Your next payday")}</label>
            <input type="date" value={nextPayday} onChange={(e) => setNextPayday(e.target.value)} style={s.input} />
          </div>
        ) : (
          <div>
            <label style={label}>{t("Payday")}</label>
            <select value={cutoffDay} onChange={(e) => setCutoffDay(+e.target.value)} style={s.input}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
            </select>
          </div>
        )}
        {asksPaycheck && (
          <div>
            <label style={label}>{t("Paycheck")}</label>
            <input inputMode="decimal" value={paycheckText} onChange={(e) => setPaycheckText(e.target.value)} style={s.input} />
          </div>
        )}
      </div>
      {asksPaycheck && (
        <p style={{ ...TYPE.finePrint, color: theme.textFaint, margin: "-8px 0 20px" }}>
          {t("Your pay for each period, after tax. Worked out from your income; change it if yours is different.")}
        </p>
      )}

      {preview.error ? (
        <p style={{ ...line, color: theme.danger }}>{t("Pick a payday after this period starts and no more than a month after it ends.")}</p>
      ) : preview.unchanged ? (
        <p style={line}>{t("This is already how you're paid, so nothing changes.")}</p>
      ) : (
        <>
          {preview.takeBack
            ? <p style={line}>{t("The switch you set up is taken back.")}</p>
            : <p style={line}>{t("New periods: {list}, …", { list: preview.periods.join(", ") })}</p>}
          <p style={line}>
            {preview.current.change === "lengthened"
              ? t("Your current period ({range}) will run on to {date}.", { range, date: endDate })
              : preview.current.end < isoDay(today)
                ? t("Your current period ({range}) will end on {date}, which has passed: today is in one of the new periods.", { range, date: endDate })
                : t("Your current period ({range}) will end on {date}.", { range, date: endDate })}
          </p>
          {preview.moved > 0 && (
            <p style={line}>
              {preview.takeBack
                ? tn(preview.moved, "{n} entry dated {date} or later moves into the next period.",
                  "{n} entries dated {date} or later move into the next period.", { date: payDate })
                : preview.made > 1
                ? tn(preview.moved, "{n} entry dated {date} or later moves into the new periods.",
                  "{n} entries dated {date} or later move into the new periods.", { date: payDate })
                : tn(preview.moved, "{n} entry dated {date} or later moves into the first new period.",
                  "{n} entries dated {date} or later move into the first new period.", { date: payDate })}
            </p>
          )}
          {!preview.takeBack && (preview.budgets.length > 0 || preview.setAside.before > 0) && (
            <>
              <div style={{ ...label, marginTop: 16 }}>{t("Budgets per period")}</div>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
                <thead>
                  <tr style={{ color: theme.textMuted }}>
                    <th style={{ ...cell, textAlign: "left" }}>{t("Category")}</th>
                    <th style={cell}>{t("Now")}</th>
                    <th style={cell}>{t("New")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.budgets.map((b) => (
                    <tr key={b.name} style={{ borderTop: `1px solid ${theme.border}` }}>
                      <td style={{ ...cell, textAlign: "left" }}>{catName(b.name)}</td>
                      <td style={cell}>{fmt(b.before)}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{fmt(b.after)}</td>
                    </tr>
                  ))}
                  {preview.setAside.before > 0 && (
                    <tr style={{ borderTop: `1px solid ${theme.border}` }}>
                      <td style={{ ...cell, textAlign: "left" }}>{t("Set aside")}</td>
                      <td style={cell}>{fmt(preview.setAside.before)}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{fmt(preview.setAside.after)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
          <p style={{ ...TYPE.finePrint, color: theme.textFaint, margin: "4px 0 16px" }}>{t("A backup is taken first, and Ctrl+Z undoes the switch.")}</p>
        </>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button style={s.linkBtn} onClick={onCancel}>{t("Cancel")}</button>
        <button
          style={{ ...s.saveBtn, width: "auto", padding: "10px 24px", opacity: canSwitch ? 1 : 0.5 }}
          disabled={!canSwitch}
          onClick={() => onSwitch(next)}
        >
          {t("Switch")}
        </button>
      </div>
    </Modal>
  );
}
