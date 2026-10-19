import { Fragment } from "react";
import { SPACE, TYPE, useThemed } from "../theme.js";
import { Modal } from "./Modal.jsx";
import { getLanguage, t } from "../i18n.js";

// **bold** and `code`, the only markup the changelog uses inside a line.
function Inline({ text }) {
  const { theme } = useThemed();
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) {
      return <code key={i} style={{ fontSize: "0.92em", padding: "0 4px", borderRadius: 4, background: theme.bg }}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

// The notes for one or more versions, as parseChangelog reads them. They
// are written in English, as on the release page.
export function WhatsNewModal({ title, entries, onClose }) {
  const { theme, s } = useThemed();
  const text = { ...TYPE.caption, color: theme.text, lineHeight: 1.6 };
  return (
    <Modal title={title} onClose={onClose} width={640}>
      {getLanguage() !== "en" && (
        <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginBottom: SPACE.sm }}>{t("These notes are in English.")}</div>
      )}
      <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 4 }}>
        {entries.map((e) => (
          <section key={e.version} style={{ marginBottom: SPACE.lg }}>
            {entries.length > 1 && (
              <h3 style={{ ...s.cardTitle, margin: `0 0 ${SPACE.xs}px` }}>
                {e.version === "Unreleased" ? t("Not released yet") : t("Version {version}", { version: e.version })}
              </h3>
            )}
            {e.blocks.map((b, i) => (b.type === "h"
              ? <h4 key={i} style={{ ...text, fontWeight: 700, margin: `${SPACE.md}px 0 ${SPACE.xs}px` }}><Inline text={b.text} /></h4>
              : b.type === "p"
              ? <p key={i} style={{ ...text, margin: `0 0 ${SPACE.sm}px` }}><Inline text={b.text} /></p>
              : (
                <ul key={i} style={{ ...text, margin: `0 0 ${SPACE.sm}px`, paddingLeft: 20 }}>
                  {b.items.map((item, j) => (
                    <li key={j} style={{ marginBottom: 6 }}>
                      <Inline text={item.text} />
                      {item.items.length > 0 && (
                        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                          {item.items.map((sub, k) => <li key={k}><Inline text={sub} /></li>)}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )))}
          </section>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: SPACE.sm }}>
        <button style={{ ...s.saveBtn, width: "auto", padding: "10px 24px" }} onClick={onClose}>{t("Got it")}</button>
      </div>
    </Modal>
  );
}
