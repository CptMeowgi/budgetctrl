import { useId } from "react";
import { t } from "../i18n.js";
import { cleanPayer, JOINT, peopleOf, personById, waysToPay } from "../lib/people.js";
import { useThemed } from "../theme.js";

// Who paid for an entry and with which account, as two selects side by side.
// `value` and `onChange` use { paidBy, paidWith }; either is left out when
// "Not set". `incoming` words it for money coming in (a credit).
// Shown only in a budget with two or more people: the forms decide that.
export function PaidByPicker({ data, value, onChange, incoming }) {
  const { theme, s } = useThemed();
  const id = useId();
  const paidBy = value?.paidBy || "";
  const paidWith = value?.paidWith || "";

  // Someone removed is offered only while the entry still names them, so
  // editing an old entry doesn't quietly pass it to another person.
  const named = paidBy && paidBy !== JOINT ? personById(data, paidBy) : null;
  const removedPayer = named?.removed ? named : null;

  // The payer's open accounts, plus the one already chosen if it has since
  // closed: cleanPayer keeps that one, so the select has to show it.
  const ways = waysToPay(data, paidBy);
  const closedChoice = paidWith && !ways.some((a) => a.id === paidWith) && cleanPayer({ paidBy, paidWith }, data).paidWith
    ? (data?.accounts || []).find((a) => a.id === paidWith)
    : null;

  // Another person's account can't stay on the entry.
  const choosePerson = (next) => onChange({ paidBy: next || undefined, paidWith: cleanPayer({ paidBy: next, paidWith }, data).paidWith });
  const chooseAccount = (next) => onChange({ paidBy: paidBy || undefined, paidWith: next || undefined });

  const label = { fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div>
        <label htmlFor={`${id}-by`} style={label}>{incoming ? t("Brought in by") : t("Paid by")}</label>
        <select id={`${id}-by`} value={paidBy} onChange={(e) => choosePerson(e.target.value)} style={s.input}>
          <option value="">{t("Not set")}</option>
          {peopleOf(data).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {removedPayer && <option value={removedPayer.id}>{removedPayer.name}</option>}
          <option value={JOINT}>{t("Joint")}</option>
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-with`} style={label}>{t("Paid with")}</label>
        <select id={`${id}-with`} value={paidWith} onChange={(e) => chooseAccount(e.target.value)} style={s.input}>
          <option value="">{t("Not set")}</option>
          {ways.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          {closedChoice && <option value={closedChoice.id}>{closedChoice.name}</option>}
        </select>
      </div>
    </div>
  );
}
