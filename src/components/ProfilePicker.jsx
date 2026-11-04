import { useEffect, useState } from "react";
import { retryDelayMs } from "../lib/lock.js";
import { ELEVATION, FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { BrandMark, Icon } from "./Icon.jsx";
import { Modal } from "./Modal.jsx";
import { t } from "../i18n.js";
import { faultText as fault } from "../text.js";

const FAILS_KEY = "budget-ctrl-profile-fails";

// { [personId]: { n, at } }: wrong passwords in a row and when the last was.
const readFails = () => {
  try {
    const all = JSON.parse(localStorage.getItem(FAILS_KEY) || "{}");
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
};
const failsOf = (all, pid) => ({ n: Number(all[pid]?.n) || 0, at: Number(all[pid]?.at) || 0 });

// Wrong passwords for one person, counted on this computer so a restart
// doesn't reset the wait. As on the PIN's lock screen, five in a row start a
// wait before the next try (retryDelayMs). The picker and the dialog that
// unlocks Mine count together.
function useProfileTries(pid) {
  const [all, setAll] = useState(readFails);
  const [now, setNow] = useState(() => Date.now());
  const mine = failsOf(all, pid);
  const waitUntil = mine.at + retryDelayMs(mine.n);
  const waiting = !!pid && waitUntil > now;

  useEffect(() => {
    if (!waiting) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [waiting]);

  const record = (next) => {
    // Read again: the other place that counts may have since.
    const stored = readFails();
    if (!next && !(pid in stored)) return;
    if (next) stored[pid] = next; else delete stored[pid];
    setAll(stored);
    setNow(Date.now());
    try {
      if (Object.keys(stored).length) localStorage.setItem(FAILS_KEY, JSON.stringify(stored));
      else localStorage.removeItem(FAILS_KEY);
    } catch { /* the wait still applies this session */ }
  };
  return {
    waiting,
    secondsLeft: Math.max(0, Math.ceil((waitUntil - now) / 1000)),
    failed: () => record({ n: failsOf(readFails(), pid).n + 1, at: Date.now() }),
    succeeded: () => record(null),
  };
}


function Initial({ person, size }) {
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: "50%", background: person.color || "#6366f1", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      fontSize: Math.round(size * 0.42), fontWeight: 700, fontFamily: FONT,
    }}>{[...String(person.name || "?")][0]?.toUpperCase()}</span>
  );
}

// A password field with its button, the wait after too many wrong tries,
// and the line that says what went wrong.
function PasswordEntry({ tries, busy, error, onSubmit }) {
  const { theme, s } = useThemed();
  const [password, setPassword] = useState("");
  const submit = async () => {
    if (busy || tries.waiting || !password) return;
    const keep = await onSubmit(password);
    if (!keep) setPassword("");
  };
  return (
    <div>
      <input type="password" autoFocus aria-label={t("Password")} placeholder={t("Password")} value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        disabled={tries.waiting}
        style={{ ...s.input, textAlign: "center" }} />
      <div style={{ ...TYPE.finePrint, minHeight: 18, marginTop: SPACE.xs, color: theme.danger, textAlign: "center" }}>
        {tries.waiting ? t("Try again in {n} s", { n: tries.secondsLeft }) : error}
      </div>
      {/* 600000 rounds of PBKDF2 take a moment, so the button says so. */}
      <button style={{ ...s.saveBtn, opacity: password && !tries.waiting ? 1 : 0.5 }} disabled={!password || tries.waiting || busy} onClick={submit}>
        {busy ? t("Checking…") : t("Unlock")}
      </button>
    </div>
  );
}

// "Who's budgeting?": shown in place of the app once a budget has profiles,
// so nothing of any budget is drawn behind it. `sealed` holds the people
// whose own budget has a password: choosing one asks for it first.
// `onOpen(pid, password?)` resolves to true once the profile is open, to
// false for a wrong password, and to null when the app closed the profile
// while it was opening (nothing is said then, and nothing typed is kept); it
// rejects for anything else, which is never called a wrong password. `onRecover(pid)`, when given, offers "Forgot your
// password?".
export function ProfilePicker({ people, sealed, onOpen, onRecover }) {
  const { theme, s } = useThemed();
  const [chosen, setChosen] = useState(null);
  // A profile found to need a password that `sealed` didn't list yet.
  const [locked, setLocked] = useState(() => new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tries = useProfileTries(chosen);
  const needsPassword = (pid) => sealed?.has(pid) || locked.has(pid);

  // Resolves to whether the password field keeps what was typed.
  const open = async (pid, password) => {
    if (busy) return true;
    setBusy(true);
    setError("");
    let ok;
    try {
      ok = await onOpen(pid, password);
    } catch (err) {
      setBusy(false);
      setError(fault(err));
      return true;
    }
    setBusy(false);
    if (ok === null) {
      setChosen(null);
      return false;
    }
    if (ok) {
      if (password !== undefined) tries.succeeded();
      return true;
    }
    if (password === undefined) {
      // It has a password after all: ask for it, with no wrong try counted.
      setLocked((set) => new Set(set).add(pid));
      setChosen(pid);
      return true;
    }
    tries.failed();
    setError(t("Wrong password."));
    return false;
  };

  const choose = (pid) => {
    if (busy) return;
    setError("");
    if (needsPassword(pid)) { setChosen(pid); return; }
    setChosen(null);
    open(pid);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: theme.outerBg, display: "flex", alignItems: "center", justifyContent: "center",
                  padding: SPACE.lg, boxSizing: "border-box", fontFamily: FONT, color: theme.text, overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 520, background: theme.modalBg, borderRadius: RADIUS.xl, border: `1px solid ${theme.cardBorder}`,
                    boxShadow: ELEVATION, padding: SPACE.xl, boxSizing: "border-box", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: SPACE.lg }}>
          <BrandMark />
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.7 }}>Budget Ctrl</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: `0 0 ${SPACE.lg}px` }}>{t("Who's budgeting?")}</h1>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: SPACE.md }}>
          {people.map((p) => {
            const on = chosen === p.id;
            return (
              <button key={p.id} onClick={() => choose(p.id)} aria-pressed={on}
                style={{ width: 120, padding: `${SPACE.md}px ${SPACE.xs}px`, borderRadius: RADIUS.lg, cursor: "pointer", fontFamily: FONT,
                         display: "flex", flexDirection: "column", alignItems: "center", gap: SPACE.sm, color: theme.text,
                         background: on ? theme.hover : "transparent", border: `1px solid ${on ? p.color || theme.accent : "transparent"}` }}>
                <Initial person={p} size={72} />
                <span style={{ ...TYPE.caption, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, maxWidth: "100%" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  {needsPassword(p.id) && <Icon name="lock" size={13} style={{ flexShrink: 0, color: theme.textFaint }} />}
                </span>
              </button>
            );
          })}
        </div>
        {chosen && needsPassword(chosen) ? (
          <div style={{ maxWidth: 300, margin: `${SPACE.lg}px auto 0` }}>
            <PasswordEntry key={chosen} tries={tries} busy={busy} error={error} onSubmit={(pw) => open(chosen, pw)} />
            {onRecover && (
              <button style={{ ...s.linkBtn, ...TYPE.finePrint, marginTop: SPACE.md }} onClick={() => onRecover(chosen)}>{t("Forgot your password?")}</button>
            )}
          </div>
        ) : error && (
          <div style={{ ...TYPE.finePrint, color: theme.danger, marginTop: SPACE.md }}>{error}</div>
        )}
      </div>
    </div>
  );
}

// A small dialog asking for a password. `person`, when given, counts wrong
// tries as the picker does. `onSubmit(password)` resolves to false for a
// wrong password ("Wrong password."), to anything else when it is done (the
// caller closes the dialog), and rejects for anything else.
export function PasswordAsk({ title, text, person, onSubmit, onClose }) {
  const { theme } = useThemed();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tries = useProfileTries(person?.id || null);
  const submit = async (password) => {
    if (busy) return true;
    setBusy(true);
    setError("");
    let ok;
    try {
      ok = await onSubmit(password);
    } catch (err) {
      setBusy(false);
      setError(fault(err));
      return true;
    }
    setBusy(false);
    if (ok !== false) {
      if (person) tries.succeeded();
      return true;
    }
    if (person) tries.failed();
    setError(t("Wrong password."));
    return false;
  };
  return (
    <Modal title={title} onClose={onClose} width={400}>
      {text && <p style={{ ...TYPE.caption, color: theme.textMuted, lineHeight: 1.55, margin: `${SPACE.xs}px 0 ${SPACE.md}px` }}>{text}</p>}
      <PasswordEntry tries={tries} busy={busy} error={error} onSubmit={submit} />
    </Modal>
  );
}
