import { useState } from "react";
import { SPACE, TYPE, useThemed } from "../theme.js";
import { Modal } from "./Modal.jsx";
import { t } from "../i18n.js";

// Adding the person who turns profiles on asks first what becomes of the
// budget so far, before anything is saved: share it as the household's, or
// keep it as one person's own and start an empty household. Nothing is
// chosen for you, since sharing shows them everything. `people` are the
// current people; "Whose is it?" starts on the first. `onShare({ markJoint })`
// and `onKeepAsMine(personId)` may take a moment; the dialog waits.
export function SecondPersonDialog({ name, people, onShare, onKeepAsMine, onClose }) {
  const { theme, s } = useThemed();
  const [choice, setChoice] = useState(null);
  const [markJoint, setMarkJoint] = useState(false);
  const [whose, setWhose] = useState(people[0]?.id || "");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (busy || !choice) return;
    setBusy(true);
    try {
      if (choice === "share") await onShare({ markJoint });
      else await onKeepAsMine(whose);
    } finally {
      setBusy(false);
    }
  };

  const option = (value, label, children) => {
    const on = choice === value;
    return (
      <div style={{ border: `1px solid ${on ? theme.accent : theme.border}`, borderRadius: 14, padding: `${SPACE.sm}px ${SPACE.md}px` }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <input type="radio" name="second-person" checked={on} onChange={() => setChoice(value)}
            style={{ accentColor: theme.accent, width: 16, height: 16, marginTop: 2, cursor: "pointer", flexShrink: 0 }} />
          <span style={{ ...TYPE.caption, color: theme.text, lineHeight: 1.5 }}>{label}</span>
        </label>
        {on && children && <div style={{ marginTop: SPACE.sm, paddingLeft: 26 }}>{children}</div>}
      </div>
    );
  };

  return (
    <Modal title={t("Adding {name}", { name })} onClose={() => { if (!busy) onClose(); }} width={500}>
      <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm, margin: `${SPACE.sm}px 0 ${SPACE.md}px` }}>
        {option("share", t("Share what's here as the household budget. {name} will see everything in it.", { name }), (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={markJoint} onChange={(e) => setMarkJoint(e.target.checked)}
              style={{ accentColor: theme.accent, width: 16, height: 16, marginTop: 2, cursor: "pointer", flexShrink: 0 }} />
            <span>
              <span style={{ ...TYPE.caption, color: theme.text }}>{t("Mark everything so far as paid jointly")}</span>
              <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, display: "block" }}>
                {t("Joint entries stay in the household: nobody can move them into their own budget later.")}
              </span>
            </span>
          </label>
        ))}
        {option("keep", t("Keep it as mine, and start an empty household"), (
          <label style={{ display: "block" }}>
            <span style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 }}>{t("Whose is it?")}</span>
            <select value={whose} onChange={(e) => setWhose(e.target.value)} style={s.input}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      <button style={{ ...s.saveBtn, opacity: choice && !busy ? 1 : 0.5, cursor: choice && !busy ? "pointer" : "not-allowed" }}
        disabled={!choice || busy} onClick={go}>
        {t("Add {name}", { name })}
      </button>
    </Modal>
  );
}
