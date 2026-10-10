import { useCallback, useEffect, useRef, useState } from "react";
import { describeUpdateError, dueForCheck, progressPercent } from "../lib/updates.js";
import { isTauri } from "../platform.js";

const UPDATE_CHECK_KEY = "budget-ctrl-last-update-check";

// Looks for a newer release on GitHub - shortly after launch, then at most once
// a day while the app sits in the tray - and installs it only when asked. The
// updater refuses anything not signed with the project's key.
export function useUpdater(autoCheck, loaded) {
  const [status, setStatus] = useState({ phase: "idle" });
  const [update, setUpdate] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [version, setVersion] = useState("");
  const [lastChecked, setLastChecked] = useState(() => {
    try { return Number(localStorage.getItem(UPDATE_CHECK_KEY)) || null; } catch { return null; }
  });
  const updateRef = useRef(null);
  updateRef.current = update;

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then((v) => { if (alive) setVersion(v); })
      .catch(() => { /* version is cosmetic */ });
    return () => { alive = false; };
  }, []);

  const check = useCallback(async ({ quiet = false } = {}) => {
    if (!isTauri) return;
    setStatus({ phase: "checking" });
    try {
      const { check: findUpdate } = await import("@tauri-apps/plugin-updater");
      const found = await findUpdate();
      const at = Date.now();
      try { localStorage.setItem(UPDATE_CHECK_KEY, String(at)); } catch { /* unavailable */ }
      setLastChecked(at);
      if (found) {
        setUpdate(found);
        setDismissed(false);
        setStatus({ phase: "available" });
      } else {
        setStatus({ phase: "current" });
      }
    } catch (err) {
      // An automatic check that fails stays silent - being offline is not news -
      // and is retried on the next hourly tick.
      setStatus(quiet ? { phase: "idle" } : { phase: "error", message: describeUpdateError(err) });
    }
  }, []);

  useEffect(() => {
    if (!isTauri || !loaded || !autoCheck) return;
    const tick = () => {
      if (updateRef.current) return;
      let last = null;
      try { last = Number(localStorage.getItem(UPDATE_CHECK_KEY)) || null; } catch { /* unavailable */ }
      if (dueForCheck(last, Date.now())) check({ quiet: true });
    };
    // Not at the very moment of launch: starting up at login is busy enough.
    const first = setTimeout(tick, 15000);
    const hourly = setInterval(tick, 60 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(hourly); };
  }, [loaded, autoCheck, check]);

  const install = useCallback(async (beforeInstall) => {
    const found = updateRef.current;
    if (!found) return;
    setStatus({ phase: "downloading", percent: null });
    try {
      // Updates never touch the budget file, but a snapshot first is cheap.
      try { await beforeInstall?.(found.version); } catch { /* never block an update on it */ }
      let downloaded = 0;
      let total = null;
      let shown = -1;
      await found.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? null;
        else if (ev.event === "Progress") {
          downloaded += ev.data.chunkLength;
          const pct = progressPercent(downloaded, total);
          if (pct !== shown) { shown = pct; setStatus({ phase: "downloading", percent: pct }); }
        } else if (ev.event === "Finished") setStatus({ phase: "installing" });
      });
      // On Windows the installer closes the app and starts the new version
      // itself; this restart is for when it has not.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setStatus({ phase: "failed", message: describeUpdateError(err, "installing the update") });
    }
  }, []);

  return {
    supported: isTauri,
    version,
    status,
    lastChecked,
    update: update ? { version: update.version, notes: update.body || "" } : null,
    dismissed,
    dismiss: () => setDismissed(true),
    check,
    install,
  };
}
