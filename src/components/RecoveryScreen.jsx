import { useEffect, useRef, useState } from "react";
import { listBackups } from "../storage.js";
import { backupLabel } from "../text.js";
import { ELEVATION, FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { BrandMark } from "./Icon.jsx";
import { t } from "../i18n.js";

// Shown instead of the app when the budget is there but can't be opened.
// Nothing is saved until you choose: restore a backup, open a backup file, or
// start a new budget. Starting fresh on its own would let the first edit save
// over the real budget.
export function RecoveryScreen({ keptAs, error, onRestoreBackup, onOpenFile, onStartNew }) {
  const { theme, s } = useThemed();
  const [backups, setBackups] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    listBackups().then((names) => { if (alive) setBackups(names); }).catch(() => { if (alive) setBackups([]); });
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: theme.outerBg, display: "flex", alignItems: "center", justifyContent: "center",
                  padding: SPACE.lg, boxSizing: "border-box", overflowY: "auto", fontFamily: FONT, color: theme.text }}>
      <div role="alertdialog" aria-label={t("Budget Ctrl couldn't open your budget")}
        style={{ width: "100%", maxWidth: 520, background: theme.modalBg, borderRadius: RADIUS.xl, border: `1px solid ${theme.cardBorder}`,
                 boxShadow: ELEVATION, padding: SPACE.xl, boxSizing: "border-box" }}>
        <BrandMark size={34} />
        <div style={{ ...TYPE.lead, fontWeight: 700, marginTop: SPACE.md }}>{t("Budget Ctrl couldn't open your budget")}</div>
        <div style={{ ...TYPE.caption, color: theme.textMuted, margin: `${SPACE.xs}px 0 ${SPACE.md}px`, lineHeight: 1.5 }}>
          {t("Nothing has been changed or overwritten. Restore one of your backups, open a backup file, or start a new budget.")}
          {keptAs && <> {t("The unreadable file was kept as {file}.", { file: keptAs })}</>}
        </div>

        <div style={s.cardTitle}>{t("Your backups")}</div>
        <div style={{ margin: `${SPACE.xs}px 0 ${SPACE.md}px`, maxHeight: 240, overflowY: "auto" }}>
          {backups === null ? <div style={s.emptySmall}>{t("Loading...")}</div>
            : backups.length === 0 ? <div style={s.emptySmall}>{t("No backups found.")}</div>
            : backups.map((name) => (
              <div key={name} style={{ ...s.miniRow, gap: SPACE.md }}>
                <span style={{ ...TYPE.caption, fontVariantNumeric: "tabular-nums" }}>{backupLabel(name)}</span>
                <button style={{ ...s.linkBtn, padding: 0, whiteSpace: "nowrap" }} onClick={() => onRestoreBackup(name)}>{t("Restore this backup")}</button>
              </div>
            ))}
        </div>

        <div style={{ display: "flex", gap: SPACE.sm, flexWrap: "wrap", alignItems: "center" }}>
          <button className="add-btn" style={s.addBtn} onClick={() => fileRef.current?.click()}>{t("Restore a backup file")}</button>
          <button style={{ ...s.linkBtn, color: theme.danger }} onClick={onStartNew}>{t("Start a new budget")}</button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) f.text().then(onOpenFile);
            }} />
        </div>
        {error && <div style={{ ...TYPE.microLegal, color: theme.textSoft, marginTop: SPACE.md }}>{t("Details: {error}", { error })}</div>}
      </div>
    </div>
  );
}
