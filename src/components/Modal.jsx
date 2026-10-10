import { useEffect } from "react";
import { useThemed } from "../theme.js";

export function Modal({ title, onClose, children, width }) {
  const { s } = useThemed();
  // Escape closes, as every desktop dialog does. Inputs that use Escape for
  // their own purpose (reverting an inline edit) stop propagation first.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={{ ...s.modal, ...(width ? { maxWidth: width } : null) }} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} style={s.closeBtn}>✕</button>
        </div>
        {/* Never taller than the window: the title stays put and the rest
            scrolls. Settings outgrew a small window and could not be read. */}
        <div style={s.modalBody}>{children}</div>
      </div>
    </div>
  );
}
