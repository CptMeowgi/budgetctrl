import { Fragment, useEffect, useState } from "react";
import { currencyOptions, LOCALE_OPTIONS } from "../money.js";
import { isLinux, isTauri, isWindows, openExternal } from "../platform.js";
import { issueUrl } from "../lib/feedback.js";
import { getStorageFault, listBackups } from "../storage.js";
import { FONT, RADIUS, SPACE, TYPE, useThemed } from "../theme.js";
import { SettingRow, Switch } from "./controls.jsx";
import { Modal } from "./Modal.jsx";
import { LicensesModal } from "./LicensesModal.jsx";
import { ago, backupLabel, ordinal } from "../text.js";
import { fmtDate, LANGUAGES, t, tk, tn } from "../i18n.js";
import { calendarFor, readSchedule } from "../lib/calendar.js";
import { PAY_KINDS, payKindChosen } from "../lib/paySchedule.js";

export function SettingsModal({ data, onClose, onChangeReminders, onChangeCurrency, onChangeLocale, onRestore, onManageCategories, updater, onChangeUpdates, onInstallUpdate,
  onChangeCutoff, onChangePay, onWhatsNew, today, onExport, onExportCsv, onImport, onImportStatement, onReset, onManageRules, lockCfg, onPinAction, onChangeLock, onChangeLanguage }) {
  const { theme, s } = useThemed();
  const [openedAt] = useState(() => Date.now());
  const rem = data.reminders || { enabled: true, leadDays: 3 };
  const payKind = payKindChosen(data);
  const switched = !!readSchedule(data);
  const cal = calendarFor(data);
  const nextPayday = cal.range(cal.next(cal.current(today))).start;
  // null until the plugin answers; the real registry entry is the source of
  // truth, so this is never persisted into `data` where it could desync.
  const [autostart, setAutostart] = useState(null);
  const [backups, setBackups] = useState([]);
  const [dataPath, setDataPath] = useState("");
  const [licensesOpen, setLicensesOpen] = useState(false);
  // The address to show when the browser couldn't be opened.
  const [unopened, setUnopened] = useState(null);
  const feedback = async (kind) => {
    const url = issueUrl(kind, { version: updater?.version, os: isWindows ? "Windows" : isLinux ? "Linux" : "" });
    setUnopened((await openExternal(url)) ? null : url);
  };

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

  // Shown in place of Settings, not on top of it, so Escape steps back one
  // dialog at a time.
  if (licensesOpen) return <LicensesModal onClose={() => setLicensesOpen(false)} />;

  return (
    <Modal title={t("Settings")} onClose={onClose}>
      <div style={group}>{t("Budget")}</div>
      <SettingRow label={t("Language")} hint={t("For the app's words and dates.")}>
        <select value={data.language || ""} onChange={(e) => onChangeLanguage(e.target.value)} style={{ ...s.input, width: 200 }}>
          {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.value === "" ? t("System default") : l.label}</option>)}
        </select>
      </SettingRow>

      <SettingRow label={t("Currency")} hint={t("Changes how every amount is displayed. It does not convert existing figures.")}>
        <select
          value={data.currency || "PLN"}
          onChange={(e) => onChangeCurrency(e.target.value)}
          style={{ ...s.input, width: 200 }}
        >
          {currencyOptions().map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
      </SettingRow>

      <SettingRow label={t("Number format")} hint={t("How amounts are grouped and punctuated.")}>
        <select
          value={data.locale || ""}
          onChange={(e) => onChangeLocale(e.target.value)}
          style={{ ...s.input, width: 200 }}
        >
          {LOCALE_OPTIONS.map((l) => <option key={l.value} value={l.value}>{l.value === "" ? t("System default") : l.label}</option>)}
        </select>
      </SettingRow>

      <SettingRow label={t("You're paid")} hint={t("How often your pay arrives. Each budget period runs from one payday to the day before the next.")}>
        <select value={payKind} onChange={(e) => e.target.value !== payKind && onChangePay({ kind: e.target.value })} style={{ ...s.input, width: 200 }}>
          {PAY_KINDS.map((k) => <option key={k.id} value={k.id}>{t(k.label)}</option>)}
        </select>
      </SettingRow>

      {payKind === "monthly" ? (
        <SettingRow label={t("Month starts on")} hint={t("Your payday. Each budget period runs from this day to the day before it, a month later.")}>
          {/* A budget that has switched before changes its payday through the
              same preview as any switch; one that never has re-sorts as always. */}
          <select value={data.cutoffDay || 1} onChange={(e) => (switched ? onChangePay({ kind: "monthly", cutoffDay: +e.target.value }) : onChangeCutoff(+e.target.value))} style={{ ...s.input, width: 200 }}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d === 1 ? t("1st (calendar month)") : ordinal(d)}</option>
            ))}
          </select>
        </SettingRow>
      ) : (
        <SettingRow label={t("Next payday")}>
          <span style={{ display: "inline-flex", gap: 12, alignItems: "baseline" }}>
            <span>{fmtDate(nextPayday, { weekday: "short", day: "numeric", month: "long" })}</span>
            <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => onChangePay({ kind: payKind })}>{t("Change…")}</button>
          </span>
        </SettingRow>
      )}

      <SettingRow label={t("Categories")} hint={t("Rename, merge, recolour or remove spending categories and income sources.")}>
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onManageCategories}>{t("Manage…")}</button>
      </SettingRow>

      <div style={divider} />
      <div style={group}>{t("Keyboard")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: SPACE.md, rowGap: 6, padding: `${SPACE.xs}px 0`, ...TYPE.caption }}>
        {[
          ["Ctrl+Z", tk("Undo")], ["Ctrl+Shift+Z / Ctrl+Y", tk("Redo")], ["Ctrl+1 … 9", tk("Switch tab")], ["Ctrl+F", tk("Search everything")], ["Ctrl+L", tk("Lock, when a PIN is set")],
          ["N", tk("New entry on this tab")], ["/", tk("Search this tab")], ["Esc", tk("Close a dialog")],
        ].map(([k, v]) => (
          <Fragment key={k}>
            <kbd style={{ fontFamily: FONT, ...TYPE.finePrint, fontWeight: 600, color: theme.text, background: theme.bg,
                          border: `1px solid ${theme.border}`, borderRadius: RADIUS.xs, padding: "3px 7px", justifySelf: "start" }}>{k}</kbd>
            <span style={{ color: theme.textMuted, alignSelf: "center" }}>{t(v)}</span>
          </Fragment>
        ))}
      </div>

      <div style={divider} />
      <div style={group}>{t("Reminders")}</div>
      <SettingRow
        label={t("Remind me about due bills")}
        hint={isTauri ? t("Closing the window keeps Budget Ctrl running in the tray.") : t("Desktop app only.")}
      >
        <Switch checked={rem.enabled} onChange={(v) => onChangeReminders({ ...rem, enabled: v })} />
      </SettingRow>
      {rem.enabled && (
        <SettingRow label={t("Days of notice")} hint={t("How far ahead of the due date to warn you.")}>
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
        <SettingRow label={t("Test it")} hint={isWindows
          ? t("Sends a reminder now. Clicking it should open the app on what's due.")
          : t("Sends a reminder now, to check notifications reach you.")}>
          <button style={s.linkBtn} onClick={async () => {
            // Elsewhere than Windows a reminder is an ordinary desktop
            // notification, as the reminder check itself falls back to.
            if (!isWindows) {
              try {
                const n = await import("@tauri-apps/plugin-notification");
                let granted = await n.isPermissionGranted();
                if (!granted) granted = (await n.requestPermission()) === "granted";
                if (!granted) throw new Error("not allowed");
                await n.sendNotification({ title: t("Budget Ctrl reminders are on"), body: t("Bills due soon will appear like this.") });
              } catch (err) {
                alert(t("Your desktop didn't show the reminder: {error}\n\nCheck that notifications are allowed for Budget Ctrl in your system settings.", { error: String(err) }));
              }
              return;
            }
            try {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("show_reminder", { title: t("Budget Ctrl reminders are on"), body: t("Click here to see what's due.") });
            } catch (err) {
              alert(t("Windows didn't show the reminder: {error}\n\nCheck that notifications are on for Budget Ctrl in Windows Settings → System → Notifications.", { error: String(err) }));
            }
          }}>{t("Send a test reminder")}</button>
        </SettingRow>
      )}

      <div style={divider} />
      <div style={group}>{t("Privacy")}</div>
      <SettingRow label={t("Lock with a PIN")} hint={t("Keeps Budget Ctrl closed to anyone else using this computer. It doesn't encrypt your budget file.")}>
        <Switch checked={!!lockCfg} onChange={(v) => onPinAction(v ? "set" : "disable")} />
      </SettingRow>
      {lockCfg && (
        <>
          <SettingRow label={t("Lock after")} hint={t("This long without using the app.")}>
            <select value={lockCfg.idleMinutes ?? 5} onChange={(e) => onChangeLock({ ...lockCfg, idleMinutes: +e.target.value })}
              style={{ ...s.input, width: 160 }}>
              {[0, 1, 5, 15, 30, 60].map((v) => (
                <option key={v} value={v}>{v === 0 ? t("Never") : v === 60 ? t("1 hour") : tn(v, "{n} minute", "{n} minutes")}</option>
              ))}
            </select>
          </SettingRow>
          <SettingRow label={t("Lock when hidden")} hint={t("When the window is minimised or closed to the tray.")}>
            <Switch checked={lockCfg.lockWhenHidden !== false} onChange={(v) => onChangeLock({ ...lockCfg, lockWhenHidden: v })} />
          </SettingRow>
          <SettingRow label={t("PIN")} hint={t("Ctrl+L locks straight away.")}>
            <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => onPinAction("change")}>{t("Change…")}</button>
          </SettingRow>
        </>
      )}

      <div style={divider} />
      <div style={group}>{t("Data")}</div>
      <SettingRow label={t("Bank statement")} hint={t("Add transactions from your bank's CSV export, without counting anything twice.")}>
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onImportStatement}>{t("Import…")}</button>
      </SettingRow>
      <SettingRow label={t("Import rules")}
        hint={`${(data.importRules || []).length ? tn((data.importRules || []).length, "{n} rule.", "{n} rules.") : t("No rules yet.")} ${t("Name and file bank transactions for you when you import a statement.")}`}>
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onManageRules}>{t("Manage…")}</button>
      </SettingRow>
      <SettingRow label={t("Back up everything")} hint={t("Your whole budget in one file, to keep somewhere safe or move to another computer.")}>
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onExport}>{t("Export…")}</button>
      </SettingRow>
      <SettingRow label={t("Restore from a backup file")} hint={t("Replaces what's here with the file's contents.")}>
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onImport}>{t("Import…")}</button>
      </SettingRow>
      <SettingRow label={t("Spreadsheet")} hint={t("Every entry as a CSV, for Excel or Google Sheets.")}>
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onExportCsv}>{t("Export CSV")}</button>
      </SettingRow>
      {isTauri && (
        <>
          {getStorageFault() && (
            <div style={{
              ...TYPE.caption, color: theme.danger, background: "rgba(239,68,68,0.1)",
              border: `1px solid ${theme.danger}`, borderRadius: RADIUS.md,
              padding: `${SPACE.sm}px ${SPACE.md}px`, marginBottom: SPACE.sm,
            }}>
              {t("Could not write the data file, so this session is running on browser storage instead, which is less durable. Export a backup now.")}
              <span style={{ display: "block", ...TYPE.microLegal, marginTop: 4 }}>{getStorageFault()}</span>
            </div>
          )}
          <div style={{ ...TYPE.finePrint, lineHeight: 1.6, color: theme.textFaint, paddingBottom: SPACE.xs }}>
            {t("Your budget is a single file on this machine. Nothing is sent anywhere.")}
            {dataPath && (
              <code style={{ display: "block", marginTop: 4, wordBreak: "break-all", color: theme.textMuted }}>{dataPath}</code>
            )}
          </div>
          <SettingRow
            label={backups.length ? tn(backups.length, "{n} backup", "{n} backups") : t("No backups yet")}
            hint={t("Taken once a day, and before any import. The newest 14 are kept.")}
          >
            {backups.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) { onRestore(e.target.value); e.target.value = ""; } }}
                style={{ ...s.input, width: 220 }}
              >
                <option value="">{t("Restore from…")}</option>
                {backups.map((b) => <option key={b} value={b}>{backupLabel(b)}</option>)}
              </select>
            )}
          </SettingRow>
        </>
      )}
      <SettingRow label={t("Start again")} hint={t("Deletes your whole budget. It's backed up first, and Ctrl+Z brings it back.")}>
        <button style={{ ...s.linkBtn, padding: 0, color: theme.danger }} onClick={onReset}>{t("Reset…")}</button>
      </SettingRow>
      {isTauri && (
        <>
          <div style={divider} />
          <div style={group}>{t("Updates")}</div>
          <SettingRow label={t("Check for updates automatically")} hint={t("Once a day. Nothing installs until you say so.")}>
            <Switch checked={data.updates?.auto !== false} onChange={(v) => onChangeUpdates({ ...(data.updates || {}), auto: v })} />
          </SettingRow>
          {(() => {
            const { status, update, lastChecked } = updater;
            const busy = status.phase === "downloading" || status.phase === "installing";
            const hint = status.phase === "checking" ? t("Checking…")
              : status.phase === "current" ? t("You're up to date.")
              : status.phase === "error" || status.phase === "failed" ? t(status.message)
              : status.phase === "downloading" ? `${t("Downloading {version}…", { version: update?.version })}${status.percent != null ? ` ${status.percent}%` : ""}`
              : status.phase === "installing" ? t("Installing. Budget Ctrl will restart.")
              : update ? t("Version {version} is available.", { version: update.version })
              : lastChecked ? t("Last checked {when}.", { when: ago(lastChecked, openedAt) })
              : t("Not checked yet.");
            return (
              <SettingRow label={updater.version ? `Budget Ctrl ${updater.version}` : "Budget Ctrl"} hint={hint}>
                {update && !busy ? (
                  <button style={{ ...s.addBtn, padding: "7px 16px" }} onClick={onInstallUpdate}>{t("Install {version}", { version: update.version })}</button>
                ) : (
                  <button style={{ ...s.linkBtn, opacity: status.phase === "checking" || busy ? 0.5 : 1 }}
                    disabled={status.phase === "checking" || busy} onClick={() => updater.check()}>{t("Check now")}</button>
                )}
              </SettingRow>
            );
          })()}

          <div style={divider} />
          <div style={group}>{t("Startup")}</div>
          <SettingRow label={isWindows ? t("Start with Windows") : t("Start when you log in")} hint={t("Launches hidden in the tray, so reminders work from boot.")}>
            <Switch checked={!!autostart} onChange={toggleAutostart} />
          </SettingRow>
        </>
      )}

      <div style={divider} />
      <div style={group}>{t("About")}</div>
      <SettingRow label={t("Feedback")} hint={t("Opens GitHub in your browser, with your app version filled in. You'll need a GitHub account. Nothing from your budget is sent.")}>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: SPACE.xs }}>
          <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => feedback("problem")}>{t("Report a problem")}</button>
          <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => feedback("idea")}>{t("Suggest an idea")}</button>
        </span>
      </SettingRow>
      {unopened && (
        <div style={{ fontSize: 11, color: theme.textMuted, userSelect: "text", wordBreak: "break-all", marginBottom: SPACE.sm }}>
          {t("Couldn't open your browser. The address is: {url}", { url: unopened })}
        </div>
      )}
      <SettingRow label={t("What's new")} hint={t("The changes in this version and the ones before it.")}>
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={onWhatsNew}>{t("Show")}</button>
      </SettingRow>
      <SettingRow label={t("Open-source licences")} hint={t("The open-source software Budget Ctrl is built with, and its licences.")}>
        <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setLicensesOpen(true)}>{t("Show")}</button>
      </SettingRow>
    </Modal>
  );
}
