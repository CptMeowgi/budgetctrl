import { useState } from "react";
import { notesToLines } from "../lib/updates.js";
import { RADIUS, SPACE, TYPE, useThemed } from "../theme.js";

export function UpdateBanner({ updater, onInstall }) {
  const { theme, s } = useThemed();
  const [notesOpen, setNotesOpen] = useState(false);
  const { status, update } = updater;
  const busy = status.phase === "downloading" || status.phase === "installing";
  if (!update || (updater.dismissed && !busy)) return null;
  const notes = notesToLines(update.notes);
  return (
    <div role="status" style={{
      ...TYPE.caption, background: `${theme.accent}12`, border: `1px solid ${theme.accent}40`,
      borderRadius: RADIUS.md, padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.md,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.md, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220, color: theme.text }}>
          {status.phase === "downloading"
            ? `Downloading Budget Ctrl ${update.version}…${status.percent != null ? ` ${status.percent}%` : ""}`
            : status.phase === "installing"
              ? `Installing Budget Ctrl ${update.version}. It will restart by itself.`
              : status.phase === "failed"
                ? `Couldn't install the update. ${status.message}`
                : <><strong>Budget Ctrl {update.version}</strong> is ready to install.</>}
        </div>
        {!busy && notes.length > 0 && (
          <button style={s.linkBtn} onClick={() => setNotesOpen(!notesOpen)}>{notesOpen ? "Hide" : "What's new"}</button>
        )}
        {!busy && (
          <button style={{ ...s.addBtn, padding: "7px 16px" }} onClick={onInstall}>
            {status.phase === "failed" ? "Try again" : "Install and restart"}
          </button>
        )}
        {!busy && <button style={s.linkBtn} onClick={updater.dismiss}>Later</button>}
      </div>
      {status.phase === "downloading" && (
        <div style={{ height: 4, background: theme.border, borderRadius: 2, overflow: "hidden", marginTop: SPACE.sm }}>
          <div style={{ height: "100%", width: `${status.percent ?? 100}%`, background: theme.accent,
                        opacity: status.percent == null ? 0.4 : 1, transition: "width .2s" }} />
        </div>
      )}
      {notesOpen && !busy && (
        <div style={{ marginTop: SPACE.sm, maxHeight: 260, overflowY: "auto", paddingRight: SPACE.xs }}>
          {notes.map((n, i) => (
            <div key={i} style={{
              ...TYPE.finePrint, lineHeight: 1.5,
              color: n.kind === "heading" ? theme.text : theme.textMuted,
              fontWeight: n.kind === "heading" ? 600 : 400,
              marginTop: n.kind === "heading" && i > 0 ? SPACE.sm : 2,
              paddingLeft: n.kind === "bullet" ? 14 : 0, textIndent: n.kind === "bullet" ? -10 : 0,
            }}>
              {n.kind === "bullet" ? "• " : ""}{n.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
