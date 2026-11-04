import { useEffect, useState } from "react";
import { FONT, SPACE, TYPE, useThemed } from "../theme.js";
import { Modal } from "./Modal.jsx";
import { backupLabel, faultText } from "../text.js";
import { t } from "../i18n.js";

// Household or Mine, at the top of the sidebar while a profile is open. The
// whole app shows the one that's chosen.
export function BudgetSwitch({ value, onChange }) {
  const { theme } = useThemed();
  const options = [["household", t("Household")], ["mine", t("Mine")]];
  return (
    <div role="radiogroup" aria-label={t("Budget")}
      style={{ display: "flex", gap: 4, padding: 4, marginTop: 24, borderRadius: 13, background: theme.bg, border: `1px solid ${theme.outerBorder}`, flexShrink: 0 }}>
      {options.map(([v, label]) => {
        const on = value === v;
        return (
          <button key={v} role="radio" aria-checked={on} className={on ? undefined : "nav-item"} onClick={() => { if (!on) onChange(v); }}
            style={{ flex: 1, height: 34, borderRadius: 10, border: "none", fontFamily: FONT, fontSize: 13, cursor: on ? "default" : "pointer",
                     background: on ? theme.outerAccentSoft : "transparent", color: on ? theme.accent : theme.outerTextMuted, fontWeight: on ? 600 : 500 }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Opening Mine found its file missing or damaged (OwnUnreadableError). The
// person chooses what happens, and nothing is written before they do:
// `onRestore(name)` restores one of Mine's backups (the app asks for its
// password if it needs one), `onStartEmpty()` starts Mine again empty. Each
// resolves once done and rejects with what went wrong, said here.
// `loadBackups()` lists Mine's backups. With no copy of a damaged file kept,
// the store refuses to write over it, and says so. `hidden` takes it off the
// screen while a backup's password is asked for, still waiting on the
// restore, so a fault in it is said here once it is back.
export function OwnUnreadableDialog({ reason, keptAs, loadBackups, onRestore, onStartEmpty, onClose, hidden = false }) {
  const { theme, s } = useThemed();
  const [backups, setBackups] = useState(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const damaged = reason === "damaged";

  useEffect(() => {
    if (!choosing) return;
    let alive = true;
    loadBackups().then((names) => { if (alive) setBackups(names); }, () => { if (alive) setBackups([]); });
    return () => { alive = false; };
  }, [choosing, loadBackups]);

  const run = async (job) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (err) {
      setError(faultText(err));
    } finally {
      setBusy(false);
    }
  };

  if (hidden) return null;

  const why = !damaged ? t("Its file isn't on this computer.")
    : keptAs ? t("A copy of the damaged file was kept.")
    : t("Its file can't be read, and no copy of it could be kept.");

  return (
    <Modal title={t("Mine")} onClose={onClose} width={460}>
      <p style={{ ...TYPE.caption, color: theme.text, lineHeight: 1.6, margin: `${SPACE.xs}px 0 ${SPACE.md}px` }}>
        {t("Your own budget couldn't be opened.")} {why}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
        <div>
          <button style={{ ...s.linkBtn, padding: 0, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={() => setChoosing(true)}>{t("Restore a backup")}</button>
          {choosing && (backups === null ? null : backups.length ? (
            <select defaultValue="" disabled={busy} style={{ ...s.input, marginTop: SPACE.xs }}
              onChange={(e) => { const name = e.target.value; e.target.value = ""; if (name) run(() => onRestore(name)); }}>
              <option value="">{t("Restore from…")}</option>
              {backups.map((b) => <option key={b} value={b}>{backupLabel(b)}</option>)}
            </select>
          ) : (
            <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: SPACE.xs }}>{t("No backups yet")}</div>
          ))}
        </div>
        <div>
          <button style={{ ...s.linkBtn, padding: 0, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={() => run(onStartEmpty)}>{t("Start it empty")}</button>
          {damaged && keptAs && <div style={{ ...TYPE.finePrint, color: theme.textFaint }}>{t("The damaged copy is kept.")}</div>}
        </div>
      </div>
      <div style={{ ...TYPE.finePrint, color: theme.danger, minHeight: 18, marginTop: SPACE.md }}>{error}</div>
    </Modal>
  );
}
