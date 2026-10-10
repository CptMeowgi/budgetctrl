import { useEffect, useRef } from "react";
import { isoDay } from "../lib/periods.js";
import { collectDueBills, whenLabel } from "../lib/reminders.js";
import { fmt } from "../money.js";
import { isTauri } from "../platform.js";

/* ---- Bill reminders ------------------------------------------------------
   The checker runs here, in the webview, rather than in Rust. Closing the
   window only hides it, so this keeps ticking in the tray, and it reuses the
   period math above instead of reimplementing cutoff-day arithmetic in a
   second language where it would drift silently. */

const REMINDER_SENT_KEY = "budget-ctrl-reminders-sent";
const REMINDER_INTERVAL_MS = 30 * 60 * 1000;
const REMINDER_STARTUP_DELAY_MS = 10 * 1000;
function buildDigest(bills) {
  if (bills.length === 1) {
    const b = bills[0];
    return { title: `${b.name} — ${whenLabel(b.inDays)}`, body: `${fmt(b.amount)} · due ${b.dueISO}` };
  }
  const total = bills.reduce((a, b) => a + b.amount, 0);
  const overdue = bills.filter((b) => b.inDays < 0).length;
  // Each line carries its own date. A bare list of names gave no way to tell
  // why something had been included, which made a wrong reminder unfalsifiable.
  const lines = bills.slice(0, 3).map((b) => `${b.name} · ${fmt(b.amount)} · ${whenLabel(b.inDays)}`);
  if (bills.length > 3) lines.push(`+${bills.length - 3} more`);
  return {
    title: `${bills.length} bills due${overdue ? ` · ${overdue} overdue` : ""} · ${fmt(total)}`,
    body: lines.join("\n"),
  };
}

function readSentMarker() {
  try { return JSON.parse(localStorage.getItem(REMINDER_SENT_KEY) || "{}"); } catch { return {}; }
}

function writeSentMarker(v) {
  try { localStorage.setItem(REMINDER_SENT_KEY, JSON.stringify(v)); } catch { /* private mode or quota: a repeated reminder beats a crash */ }
}

export function useReminders(data, loaded, setTodayKey, onReminderOpened) {
  // Read through a ref so the interval is installed once instead of being torn
  // down and restarted on every keystroke that edits the budget.
  const dataRef = useRef(data);
  dataRef.current = data;

  // Rollover watch, deliberately outside the Tauri guard: an app parked in the
  // tray can go days without re-rendering, leaving the header date and the
  // active period stale. setState bails out when the value is unchanged, so
  // this is free on every tick but the one that crosses midnight.
  useEffect(() => {
    const iv = setInterval(() => setTodayKey(isoDay(new Date())), 60 * 1000);
    return () => clearInterval(iv);
  }, [setTodayKey]);

  useEffect(() => {
    if (!loaded || !isTauri) return;
    let alive = true;

    const tick = async () => {
      if (!alive) return;
      const d = dataRef.current;
      const rem = d.reminders || {};
      if (rem.enabled === false) return;
      const leadDays = Number.isFinite(rem.leadDays) ? rem.leadDays : 3;

      // new Date() per tick, never a render-time value - this process outlives
      // its renders by days.
      const now = new Date();
      const bills = collectDueBills(d, now, leadDays);
      if (!bills.length) return;

      // Fire once a day, and again if the set itself changes mid-day.
      const sig = bills.map((b) => b.id).join("|");
      const today = isoDay(now);
      const sent = readSentMarker();
      if (sent.date === today && sent.sig === sig) return;

      try {
        const { title, body } = buildDigest(bills);
        const { invoke } = await import("@tauri-apps/api/core");
        try {
          // Our own toast, which opens the app on the due list when clicked.
          await invoke("show_reminder", { title, body });
        } catch {
          // Not Windows, or the toast failed: a plain notification still beats
          // a silent missed bill.
          const n = await import("@tauri-apps/plugin-notification");
          let granted = await n.isPermissionGranted();
          if (!granted) granted = (await n.requestPermission()) === "granted";
          if (!granted || !alive) return;
          await n.sendNotification({ title, body });
        }
        writeSentMarker({ date: today, sig });
      } catch { /* Tauri API unavailable (browser dev server) */ }
    };

    // A clicked reminder opens the app at budgetctrl://due-soon. Rust brings
    // the window forward and says so here; if the click is what launched the
    // app, the page asks once it has loaded.
    let unlistenClick;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");
        unlistenClick = await listen("open-due-soon", () => {
          if (!alive) return;
          invoke("take_open_due_soon").catch(() => {});
          onReminderOpened();
        });
        if (alive && await invoke("take_open_due_soon")) onReminderOpened();
      } catch { /* Tauri API unavailable (browser dev server) */ }
    })();

    const onWindowFocus = () => tick();

    const startup = setTimeout(tick, REMINDER_STARTUP_DELAY_MS);
    const iv = setInterval(tick, REMINDER_INTERVAL_MS);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      alive = false;
      clearTimeout(startup);
      clearInterval(iv);
      window.removeEventListener("focus", onWindowFocus);
      if (unlistenClick) unlistenClick();
    };
  }, [loaded, onReminderOpened]);
}
