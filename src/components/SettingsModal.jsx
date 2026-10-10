import { Fragment, useEffect, useState } from "react";
import { agoLabel } from "../lib/updates.js";
import { currencyOptions, LOCALE_OPTIONS } from "../money.js";
import { isTauri } from "../platform.js";
import { getStorageFault, listBackups } from "../storage.js";
import { FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { SettingRow, Switch } from "./controls.jsx";
import { Modal } from "./Modal.jsx";

function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  return `${n}${suffix}`;
}

export function SettingsModal({ data, onClose, onChangeReminders, onChangeCurrency, onChangeLocale, onRestore, onManageCategories, updater, onChangeUpdates, onInstallUpdate,
  onChangeCutoff, onExport, onExportCsv, onImport, onImportStatement, onReset }) {
  const { theme, s } = useThemed();
  const [openedAt] = useState(() => Date.now());
  const rem = data.reminders || { enabled: true, leadDays: 3 };
  // null until the plugin answers; the real registry entry is the source of
  // truth, so this is never persisted into `data` where it could desync.
  const [autostart, setAutostart] = useState(null);
  const [backups, setBackups] = useState([]);
  const [dataPath, setDataPath] = useState("");

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    (async () => {
      const names = await listBackups();
      if (alive) setBackups(names);
      try {
        const { appDataDir } = await import("@tauri-apps/api/path");
        const dir = await appDataDir();
        if (alive) setDataPath(dir);
      } catch { /* path API unavailable; the list alone is still useful */ }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    (async () => {
      try {
        const a = await import("@tauri-apps/plugin-autostart");
        const on = await a.isEnabled();
        if (alive) setAutostart(on);
      } catch { if (alive) setAutostart(false); }
    })();
    return () => { alive = false; };
  }, []);

  const toggleAutostart = async () => {
    try {
      const a = await import("@tauri-apps/plugin-autostart");
      if (autostart) { await a.disable(); setAutostart(false); }
      else { await a.enable(); setAutostart(true); }
    } catch { /* Tauri API unavailable (browser dev server) */ }
  };

  const group = { fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2, color: theme.textMuted, fontWeight: 600, marginBottom: 2 };
  const divider = { borderTop: `1px solid ${theme.border}`, margin: "6px 0" };

  return (
    <Modal title="Settings" onClose={onClose}>
      <div style={group}>Budget</div>
      <SettingRow label="Currency" hint="Changes how every amount is displayed. It does not convert existing figures.">
        <select
          value={data.currency || "PLN"}
          onChange={(e) => onChangeCurrency(e.target.value)}
          style={{ ...s.input, width: 200 }}
        >
          {currencyOptions().map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
      </SettingRow>

      <SettingRow label="Number format" hint="How amounts are grouped and punctuated.">
        <select
          value={data.locale || ""}
          onChange={(e) => onChangeLocale(e.target.value)}
          style={{ ...s.input, width: 200 }}
        >
          {LOCALE_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </SettingRow>

      <SettingRow label="Month starts on" hint="Your payday. Each budget period runs from this day to the day before it, a month later.">
        <select value={data.cutoffDay || 1} onChange={(e) => onChangeCutoff(+e.target.value)} style={{ ...s.input, width: 200 }}>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{d === 1 ? "1st (calendar month)" : ordinal(d)}</option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label="Categories" hint="Rename, merge, recolour or remove spending categories and income sources.">
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onManageCategories}>Manage…</button>
      </SettingRow>

      <div style={divider} />
      <div style={group}>Keyboard</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: SPACE.md, rowGap: 6, padding: `${SPACE.xs}px 0`, ...TYPE.caption }}>
        {[
          ["Ctrl+Z", "Undo"], ["Ctrl+Shift+Z / Ctrl+Y", "Redo"], ["Ctrl+1 … 9", "Switch tab"],
          ["N", "New entry on this tab"], ["/", "Search this tab"], ["Esc", "Close a dialog"],
        ].map(([k, v]) => (
          <Fragment key={k}>
            <kbd style={{ fontFamily: FONT, ...TYPE.finePrint, fontWeight: 600, color: theme.text, background: theme.bg,
                          border: `1px solid ${theme.border}`, borderRadius: RADIUS.xs, padding: "3px 7px", justifySelf: "start" }}>{k}</kbd>
            <span style={{ color: theme.textMuted, alignSelf: "center" }}>{v}</span>
          </Fragment>
        ))}
      </div>

      <div style={divider} />
      <div style={group}>Reminders</div>
      <SettingRow
        label="Remind me about due bills"
        hint={isTauri ? "Closing the window keeps Budget Ctrl running in the tray." : "Desktop app only."}
      >
        <Switch checked={rem.enabled} onChange={(v) => onChangeReminders({ ...rem, enabled: v })} />
      </SettingRow>
      {rem.enabled && (
        <SettingRow label="Days of notice" hint="How far ahead of the due date to warn you.">
          <input
            type="number" min={0} max={30} value={rem.leadDays}
            onChange={(e) => {
              const n = Math.max(0, Math.min(30, Math.floor(+e.target.value) || 0));
              onChangeReminders({ ...rem, leadDays: n });
            }}
            style={{ ...s.input, width: 72, textAlign: "center" }}
          />
        </SettingRow>
      )}
      {rem.enabled && isTauri && (
        <SettingRow label="Test it" hint="Sends a reminder now. Clicking it should open the app on what's due.">
          <button style={s.linkBtn} onClick={async () => {
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("show_reminder", { title: "Budget Ctrl reminders are on", body: "Click here to see what's due." });
            } catch (err) {
              alert(`Windows didn't show the reminder: ${err}\n\nCheck that notifications are on for Budget Ctrl in Windows Settings → System → Notifications.`);
            }
          }}>Send a test reminder</button>
        </SettingRow>
      )}

      <div style={divider} />
      <div style={group}>Data</div>
      <SettingRow label="Bank statement" hint="Add transactions from your bank's CSV export, without counting anything twice.">
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onImportStatement}>Import…</button>
      </SettingRow>
      <SettingRow label="Back up everything" hint="Your whole budget in one file, to keep somewhere safe or move to another computer.">
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onExport}>Export…</button>
      </SettingRow>
      <SettingRow label="Restore from a backup file" hint="Replaces what's here with the file's contents.">
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onImport}>Import…</button>
      </SettingRow>
      <SettingRow label="Spreadsheet" hint="Every entry as a CSV, for Excel or Google Sheets.">
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onExportCsv}>Export CSV</button>
      </SettingRow>
      {isTauri && (
        <>
          {getStorageFault() && (
            <div style={{
              ...TYPE.caption, color: theme.danger, background: "rgba(239,68,68,0.1)",
              border: `1px solid ${theme.danger}`, borderRadius: RADIUS.md,
              padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.sm,
            }}>
              Could not write the data file, so this session is running on browser
              storage instead, which is less durable. Export a backup now.
              <span style={{ display: "block", ...TYPE.microLegal, marginTop: 4 }}>{getStorageFault()}</span>
            </div>
          )}
          <div style={{ ...TYPE.finePrint, lineHeight: 1.6, color: theme.textFaint, paddingBottom: SPACE.xs }}>
            Your budget is a single file on this machine. Nothing is sent anywhere.
            {dataPath && (
              <code style={{ display: "block", marginTop: 4, wordBreak: "break-all", color: theme.textMuted }}>{dataPath}</code>
            )}
          </div>
          <SettingRow
            label={backups.length ? `${backups.length} backup${backups.length !== 1 ? "s" : ""}` : "No backups yet"}
            hint="Taken once a day, and before any import. The newest 14 are kept."
          >
            {backups.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) { onRestore(e.target.value); e.target.value = ""; } }}
                style={{ ...s.input, width: 220 }}
              >
                <option value="">Restore from…</option>
                {backups.map((b) => <option key={b} value={b}>{b.replace(/^budget-ctrl-|\.json$/g, "")}</option>)}
              </select>
            )}
          </SettingRow>
        </>
      )}
      <SettingRow label="Start again" hint="Deletes your whole budget. It's backed up first, and Ctrl+Z brings it back.">
        <button style={{ ...s.linkBtn, padding: 0, color: theme.danger }} onClick={onReset}>Reset…</button>
      </SettingRow>
      {isTauri && (
        <>
          <div style={divider} />
          <div style={group}>Updates</div>
          <SettingRow label="Check for updates automatically" hint="Once a day. Nothing installs until you say so.">
            <Switch checked={data.updates?.auto !== false} onChange={(v) => onChangeUpdates({ ...(data.updates || {}), auto: v })} />
          </SettingRow>
          {(() => {
            const { status, update, lastChecked } = updater;
            const busy = status.phase === "downloading" || status.phase === "installing";
            const hint = status.phase === "checking" ? "Checking…"
              : status.phase === "current" ? "You're up to date."
              : status.phase === "error" || status.phase === "failed" ? status.message
              : status.phase === "downloading" ? `Downloading ${update?.version}…${status.percent != null ? ` ${status.percent}%` : ""}`
              : status.phase === "installing" ? "Installing. Budget Ctrl will restart."
              : update ? `Version ${update.version} is available.`
              : lastChecked ? `Last checked ${agoLabel(lastChecked, openedAt)}.`
              : "Not checked yet.";
            return (
              <SettingRow label={updater.version ? `Budget Ctrl ${updater.version}` : "Budget Ctrl"} hint={hint}>
                {update && !busy ? (
                  <button style={{ ...s.addBtn, padding: "7px 16px" }} onClick={onInstallUpdate}>Install {update.version}</button>
                ) : (
                  <button style={{ ...s.linkBtn, opacity: status.phase === "checking" || busy ? 0.5 : 1 }}
                    disabled={status.phase === "checking" || busy} onClick={() => updater.check()}>
                    Check now
                  </button>
                )}
              </SettingRow>
            );
          })()}

          <div style={divider} />
          <div style={group}>Startup</div>
          <SettingRow label="Start with Windows" hint="Launches hidden in the tray, so reminders work from boot.">
            <Switch checked={!!autostart} onChange={toggleAutostart} />
          </SettingRow>
        </>
      )}
    </Modal>
  );
}
