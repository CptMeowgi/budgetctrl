import { t } from "./i18n.js";
import { cleanPayer, isShared, personById, readLastPayer, rememberPayer } from "./lib/people.js";

// Optional free text on any entry. Blank is stored as absent, not "".
export function cleanNote(s) {
  const v = (s || "").trim();
  return v || undefined;
}

export const NOTE_FIELD = (editing) => ({ key: "note", label: t("Note"), type: "textarea", placeholder: t("Optional — reference, who, why"), defaultValue: editing?.note });

// Who paid, in the forms. A budget with fewer than two people has no such
// field and its saves leave `paidBy`/`paidWith` alone, so values from an
// earlier shared time survive.
//
// An edited entry starts from its own payer. It goes through cleanPayer, so a
// stale id is dropped but a removed person or a closed account of the payer's
// stays: saving an old entry doesn't wipe who paid it.
//
// A new entry starts from the last payer chosen on this computer, but never on
// someone since removed or an account since closed: those are for old entries,
// and nothing new should be spent against them without the user choosing so.
// The account chosen with a removed person goes with them: with no payer left
// it would be offered as anyone's.
export function startingPayer(data, entry) {
  if (entry) return cleanPayer({ paidBy: entry.paidBy, paidWith: entry.paidWith }, data);
  const last = readLastPayer();
  if (personById(data, last.paidBy)?.removed) {
    delete last.paidBy;
    delete last.paidWith;
  }
  const out = cleanPayer(last, data);
  if ((data?.accounts || []).find((a) => a.id === out.paidWith)?.closed) delete out.paidWith;
  return out;
}

// The form field, for FormModal's `fields`; `incoming` is for money coming in.
export const payerField = (data, entry, { incoming } = {}) => (
  isShared(data) ? [{ key: "payer", type: "payer", data, incoming, defaultValue: startingPayer(data, entry) }] : []
);

// What a save puts into the entry from the form's payer. Both keys are always
// given when shared, `undefined` for one that isn't, so "Not set" really clears
// (undefined keys drop out when the budget is saved). Adding an entry also
// remembers the choice for the next one.
export function payerToSave(data, payer, adding) {
  if (!isShared(data)) return {};
  const { paidBy, paidWith } = cleanPayer(payer, data);
  if (adding) rememberPayer({ paidBy, paidWith });
  return { paidBy, paidWith };
}
