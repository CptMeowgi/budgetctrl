import { Fragment, useEffect, useState } from "react";
import { checkPin, makeLock, PIN_MAX, PIN_MIN, retryDelayMs, validPin } from "../lib/lock.js";
import { isTauri } from "../platform.js";
import { LOCK_FILE } from "../storage.js";
import { ELEVATION, FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { Modal } from "./Modal.jsx";
import { t } from "../i18n.js";

const FAILS_KEY = "budget-ctrl-lock-fails";

// Shown instead of the app - nothing of the budget is drawn behind it.
export function LockScreen({ lock, onUnlock }) {
  const { theme, s } = useThemed();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [forgot, setForgot] = useState(false);
  const [folder, setFolder] = useState("");
  // Failed tries survive a restart, so quitting the app does not reset the wait.
  const [fails, setFails] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FAILS_KEY) || '{"n":0,"at":0}'); } catch { return { n: 0, at: 0 }; }
  });
  const waitUntil = fails.at + retryDelayMs(fails.n);
  const waiting = waitUntil > now;

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting]);

  useEffect(() => {
    if (!forgot || !isTauri) return;
    import("@tauri-apps/api/path").then((p) => p.appDataDir()).then(setFolder).catch(() => {});
  }, [forgot]);

  const record = (next) => {
    setFails(next);
    try { localStorage.setItem(FAILS_KEY, JSON.stringify(next)); } catch { /* the wait still applies this session */ }
  };

  const submit = async () => {
    if (busy || waiting || !pin) return;
    setBusy(true);
    const ok = await checkPin(lock, pin);
    setBusy(false);
    if (ok) {
      record({ n: 0, at: 0 });
      onUnlock();
      return;
    }
    const next = { n: fails.n + 1, at: Date.now() };
    record(next);
    setNow(Date.now());
    setPin("");
    setError(retryDelayMs(next.n) ? t("Wrong PIN. Too many tries - wait a moment.") : t("Wrong PIN."));
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: theme.outerBg, display: "flex", alignItems: "center", justifyContent: "center",
                  padding: SPACE.lg, boxSizing: "border-box", fontFamily: FONT, color: theme.text }}>
      <div style={{ width: "100%", maxWidth: 360, background: theme.surface, borderRadius: RADIUS.lg, border: `1px solid ${theme.border}`,
                    boxShadow: ELEVATION, padding: SPACE.xl, boxSizing: "border-box", textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>BUDGET</div>
        <div style={{ fontSize: 10, letterSpacing: 3, color: theme.accent, fontWeight: 700, marginBottom: SPACE.lg }}>CTRL</div>
        <div style={{ ...TYPE.caption, color: theme.textMuted, marginBottom: SPACE.md }}>{t("Locked. Enter your PIN to open.")}</div>
        <input type="password" inputMode="numeric" autoFocus aria-label={t("PIN")} maxLength={PIN_MAX} value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          disabled={waiting}
          style={{ ...s.input, textAlign: "center", fontSize: 22, letterSpacing: 8 }} />
        <div style={{ ...TYPE.finePrint, minHeight: 18, marginTop: SPACE.xs, color: theme.danger }}>
          {waiting ? t("Try again in {n} s", { n: Math.ceil((waitUntil - now) / 1000) }) : error}
        </div>
        <button style={{ ...s.saveBtn, opacity: pin && !waiting ? 1 : 0.5 }} disabled={!pin || waiting || busy} onClick={submit}>
          {busy ? t("Checking…") : t("Unlock")}
        </button>
        <button style={{ ...s.linkBtn, ...TYPE.finePrint, marginTop: SPACE.md }} onClick={() => setForgot(!forgot)}>{t("Forgot your PIN?")}</button>
        {forgot && (
          <div style={{ ...TYPE.finePrint, color: theme.textMuted, lineHeight: 1.55, textAlign: "left", marginTop: SPACE.xs }}>
            {t("The lock is a small file, {file}, next to your budget.", { file: <strong key="f">{LOCK_FILE}</strong> })}
            {folder && <Fragment> {t("It's in {folder}.", { folder: <code key="c" style={{ wordBreak: "break-all" }}>{folder}</code> })}</Fragment>}
            {" "}{t("Quit Budget Ctrl from its tray icon, delete that file, and open it again: the lock is gone and your budget is untouched.")}
          </div>
        )}
      </div>
    </div>
  );
}

// Turn the lock on, change the PIN, or turn it off. Turning it off or changing
// the PIN needs the current one.
export function PinDialog({ mode, lock, onDone, onClose }) {
  const { theme, s } = useThemed();
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needCurrent = mode !== "set";
  const needNew = mode !== "disable";
  const title = mode === "set" ? t("Lock with a PIN") : mode === "change" ? t("Change PIN") : t("Turn off the lock");
  const digits = (set) => (e) => { set(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX)); setError(""); };

  const submit = async () => {
    if (busy) return;
    if (needNew && !validPin(pin)) return setError(t("Use {min} to {max} digits.", { min: PIN_MIN, max: PIN_MAX }));
    if (needNew && pin !== again) return setError(t("The two PINs don't match."));
    setBusy(true);
    try {
      if (needCurrent && !(await checkPin(lock, current))) { setError(t("That isn't your current PIN.")); return; }
      onDone(mode === "disable" ? null : await makeLock(pin, lock || {}));
    } finally {
      setBusy(false);
    }
  };

  const field = (label, value, onChange, auto) => (
    <div style={{ marginTop: SPACE.md }}>
      <label style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 }}>{label}</label>
      <input type="password" inputMode="numeric" autoFocus={auto} value={value} onChange={onChange} aria-label={label}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        style={{ ...s.input, letterSpacing: 6, textAlign: "center", fontSize: 18 }} />
    </div>
  );

  return (
    <Modal title={title} onClose={onClose}>
      {mode === "set" && (
        <div style={{ ...TYPE.caption, color: theme.textMuted, lineHeight: 1.5, marginTop: SPACE.xs }}>{t("Keeps Budget Ctrl closed to anyone else using this computer. It doesn't encrypt your budget file, and reminders still appear while it's locked.")}</div>
      )}
      {needCurrent && field(t("Current PIN"), current, digits(setCurrent), true)}
      {needNew && field(mode === "change" ? t("New PIN") : t("PIN ({min}–{max} digits)", { min: PIN_MIN, max: PIN_MAX }), pin, digits(setPin), !needCurrent)}
      {needNew && field(t("Again"), again, digits(setAgain), false)}
      <div style={{ ...TYPE.finePrint, color: theme.danger, minHeight: 18, marginTop: SPACE.xs }}>{error}</div>
      <button style={{ ...s.saveBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
        {busy ? t("Checking…") : mode === "disable" ? t("Turn off") : t("Save")}
      </button>
    </Modal>
  );
}
