import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { closeAccount, recordBalance, removeBalance, reopenAccount } from "./lib/accounts.js";
import { capAt, startFresh, withCap, withRollover } from "./lib/envelopes.js";
import { goalStatus, goalsMonthlyNeed, leftOverHistory } from "./lib/goals.js";
import { convertToRecurring, dismissRegular, findRegularPayments } from "./lib/regular.js";
import { forecast } from "./lib/forecast.js";
import { applySetup } from "./lib/setup.js";
import { isoDay, setLabelLocale } from "./lib/periods.js";
import { calendarFor } from "./lib/calendar.js";
import { collectDueBills, OVERDUE_GRACE_DAYS, upcomingSettled } from "./lib/reminders.js";
import { dayOfMonthFrom, REPEAT_OPTIONS, repeatLabel, scheduleFromForm } from "./lib/schedule.js";
import { isRecurringItem, isWeekly, missingCopies, occursIn } from "./lib/occurrences.js";
import { deleteRecurringCopy, deleteTemplate, editFormFor, saveRecurring } from "./lib/recurringEdits.js";
import { allNotes, APP_VERSION, loadChangelog, whatsNewAtLaunch } from "./lib/whatsNew.js";
import { WhatsNewModal } from "./components/WhatsNewModal.jsx";
import { creditReceived, periodIncome, periodSpending } from "./lib/totals.js";
import { AccountModal, AccountsView } from "./components/AccountsView.jsx";
import { CategoryManager } from "./components/CategoryManager.jsx";
import { CategoryPill, StatCard, TableHeader, Toast } from "./components/controls.jsx";
import { GoalModal, SavingsView } from "./components/SavingsView.jsx";
import { SearchModal } from "./components/SearchModal.jsx";
import { RulesManager } from "./components/RulesManager.jsx";
import { BillCalendar, ForecastCard } from "./components/BillCalendar.jsx";
import { SetupWizard } from "./components/SetupWizard.jsx";
import { LockScreen, PinDialog } from "./components/LockScreen.jsx";
import { FormModal } from "./components/FormModal.jsx";
import { ExpenseModal } from "./components/ExpenseModal.jsx";
import { ReportsView } from "./components/ReportsView.jsx";
import { EntryName, ExpenseRow, MissingFromTemplate, NotDueThisPeriod, RecurringRow, RowActions, UpcomingRow } from "./components/rows.jsx";
import { SettingsModal } from "./components/SettingsModal.jsx";
import { PayScheduleModal } from "./components/PayScheduleModal.jsx";
import { perPeriodOf } from "./lib/paySchedule.js";
import { StatementImport } from "./components/StatementImport.jsx";
import { UpdateBanner } from "./components/UpdateBanner.jsx";
import { WindowControls } from "./components/WindowControls.jsx";
import { DeleteArmContext } from "./contexts.js";
import { exportCsv, exportData } from "./exportFiles.js";
import { cleanNote, NOTE_FIELD } from "./forms.js";
import { useReminders } from "./hooks/useReminders.js";
import { useUpdater } from "./hooks/useUpdater.js";
import { ENTRY_COLUMNS, filterAndSort, toggleSort } from "./listView.js";
import { countRebucketMoves, CREDIT_UNCATEGORIZED, defaultData, emptyMonth, ensureCategory, ensureCreditCategory, ensureCurrentMonth, hydrate, migrate, rebucketData, STORAGE_KEY, uid } from "./model.js";
import { currencyCode, fmt, setMoneyFormat } from "./money.js";
import { isLinux, isTauri } from "./platform.js";
import { due, ordinal, shortDate } from "./text.js";
import { readBackup, readLock, setAsideUnreadable, writeBackup, writeLock } from "./storage.js";
import { RecoveryScreen } from "./components/RecoveryScreen.jsx";
import { DARK_THEME, FOCUS_RING, FONT, LIGHT_THEME, makeStyles, RADIUS, SPACE, ThemeContext, TYPE } from "./theme.js";
import { BrandMark, Icon } from "./components/Icon.jsx";
import { Dashboard } from "./components/Dashboard.jsx";
import { dateLocale, fmtDate, setLanguage, t, tk, tn } from "./i18n.js";

const UNDO_LIMIT = 50;
const THEME_KEY = "budget-ctrl-theme";

// Development only: ?demo opens a made-up budget instead of yours (for
// screenshots and trying things), and &tab=, &theme=, &lang= choose what it
// shows. The installed app never reads these.
const DEMO = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;

// Saves the budget, unless it's the demo: that one lives only in memory, so
// trying things in it never overwrites the budget it stands in for.
const persist = (value) => (DEMO?.has("demo") ? Promise.resolve() : window.storage.set(STORAGE_KEY, JSON.stringify(value)));

// The Dashboard greets rather than names the tab.
function greeting(now) {
  const h = now.getHours();
  return h < 5 ? t("Good evening") : h < 12 ? t("Good morning") : h < 18 ? t("Good afternoon") : t("Good evening");
}

function monthShort(key) {
  const [y, m] = key.split("-").map(Number);
  return fmtDate(new Date(y, m - 1, 1), { month: "short" });
}

// Which tabs offer an "+ Add" CTA, what it is called, and which modal it opens.
// Previously three parallel inline ternaries in the header that had to be kept
// in sync by hand.
const ADD_LABELS = {
  dashboard: tk("+ Add Expense"),
  expenses: tk("+ Add Expense"),
  recurring: tk("+ Add Recurring"),
  upcoming: tk("+ Add Payment"),
  accounts: tk("+ Add Account"),
  savings: tk("+ Add Goal"),
};
// The weeks a Repeats choice steps by, or nothing for a monthly one: the
// recurring forms show a first date for weekly items and a day of the month
// otherwise.
const weeklyChoice = (vals) => REPEAT_OPTIONS.find((o) => o.label === vals.repeats)?.weeks;

const MODAL_FOR_TAB = { dashboard: "expense", expenses: "expense", accounts: "account", savings: "goal" };

const TABS = [
  { id: "dashboard", label: tk("Dashboard"), icon: "grid" },
  { id: "expenses", label: tk("Expenses"), icon: "receipt" },
  { id: "recurring", label: tk("Recurring"), icon: "repeat" },
  { id: "upcoming", label: tk("Upcoming"), icon: "calendar" },
  { id: "credits", label: tk("Credits"), icon: "money-in" },
  { id: "history", label: tk("History"), icon: "clock" },
  { id: "reports", label: tk("Reports"), icon: "chart" },
  { id: "savings", label: tk("Savings"), icon: "target" },
  { id: "accounts", label: tk("Accounts"), icon: "wallet" },
];

export default function App() {
  const [data, setData] = useState(defaultData());
  // Undo history. Snapshots are cheap: every update is immutable, so each one
  // shares all unchanged structure with its predecessor.
  const dataRef = useRef(data);
  dataRef.current = data;
  const historyRef = useRef({ past: [], future: [], lastPushAt: 0 });
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState(() => DEMO?.get("tab") || "dashboard");
  const [modal, setModal] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [historyKey, setHistoryKey] = useState(null);
  const [reportRange, setReportRange] = useState(null);
  const importInputRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  // Dark by default. A new key rather than the old "themeMode", so everyone
  // meets the redesign in dark once and keeps whatever they choose after.
  const [themeMode, setThemeMode] = useState(() => {
    if (DEMO?.get("theme")) return DEMO.get("theme");
    try { return localStorage.getItem(THEME_KEY) || "dark"; } catch { return "dark"; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The "Change how you're paid" dialog: { kind, cutoffDay } while open.
  const [payDialog, setPayDialog] = useState(null);
  // { entries, launch }: the notes, after an update or from Settings.
  const [whatsNew, setWhatsNew] = useState(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  // The welcome screens: shown once, for a budget created on this launch.
  const [setupOpen, setSetupOpen] = useState(false);
  // App lock: undefined until lock.json has been read, so the budget is never
  // drawn for a moment before the lock screen.
  const [lockCfg, setLockCfg] = useState(undefined);
  const [locked, setLocked] = useState(false);
  const [pinDialog, setPinDialog] = useState(null);
  const [statementOpen, setStatementOpen] = useState(false);
  // Set when the budget is there but can't be opened: the recovery screen
  // replaces the app, and nothing is saved until the user chooses what to do.
  const [loadError, setLoadError] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Kept while the dialog is closed, so reopening it carries on where you were.
  const [searchQuery, setSearchQuery] = useState({ text: "", kinds: [] });
  // Bumped by the reminder tick when the calendar date rolls over; `today`
  // below is keyed to it so a long-lived tray session doesn't show a stale date.
  const [todayKey, setTodayKey] = useState(() => isoDay(new Date()));
  const [expensesView, setExpensesView] = useState({ search: "", sorts: [] });
  const [recurringView, setRecurringView] = useState({ search: "", sorts: [] });
  const [upcomingView, setUpcomingView] = useState({ search: "", sorts: [] });
  const [creditsView, setCreditsView] = useState({ search: "", sorts: [] });
  const triggerImport = () => importInputRef.current?.click();
  const resetAll = async () => {
    if (!confirm(t("Delete your whole budget and start again?\n\nWhat you have now is backed up first, and Ctrl+Z undoes it."))) return;
    if (isTauri) {
      try {
        const current = await window.storage.get(STORAGE_KEY);
        if (current?.value) await writeBackup(current.value, "before-reset");
      } catch { /* the undo step still holds it */ }
    }
    await save(hydrate(defaultData()));
    setSettingsOpen(false);
  };
  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== "object" || !parsed.months || typeof parsed.months !== "object") {
          alert(t("Could not read backup file. Make sure it's a valid budget-ctrl JSON export."));
          return;
        }
        if (!confirm(t("Replace all your current data with this backup?\n\nWhat you have now is backed up first, and Ctrl+Z undoes it."))) return;
        // Snapshot what is about to be overwritten, as well as the undo step.
        if (isTauri) {
          try {
            const current = await window.storage.get(STORAGE_KEY);
            if (current?.value) await writeBackup(current.value, "before-import");
          } catch { /* never block the import on a failed snapshot */ }
        }
        const migrated = hydrate(migrate(parsed));
        save(migrated);
      } catch {
        alert(t("Could not read backup file. Make sure it's a valid budget-ctrl JSON export."));
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  // Every user change goes through here and becomes undoable. System writes -
  // first-launch defaults, the period rollover - pass { undoable: false }, so
  // Ctrl+Z can never undo something the user did not do.
  const save = useCallback(async (next, opts = {}) => {
    if (opts.undoable !== false) {
      const h = historyRef.current;
      const now = Date.now();
      // Saves within a second coalesce into one step. Some inputs save on every
      // keystroke; undo should step back over "8000", not over each digit.
      if (now - h.lastPushAt > 1000 || !h.past.length) {
        h.past.push(dataRef.current);
        if (h.past.length > UNDO_LIMIT) h.past.shift();
      }
      h.lastPushAt = now;
      h.future = [];
      setHistorySize({ past: h.past.length, future: 0 });
    }
    setData(next);
    try { await persist(next); } catch { /* in-memory state still updated; surfaced on next load */ }
  }, []);

  useEffect(() => {
    (async () => {
      // import.meta.env.DEV first, so the release build drops this - demo.js
      // included - instead of shipping it unused.
      if (import.meta.env.DEV && DEMO.has("demo")) {
        const { demoData, fortnightlyDemo } = await import("./demo.js");
        const lang = DEMO.get("lang") || "en";
        setData(hydrate(DEMO.get("pay") === "fortnightly" ? fortnightlyDemo(new Date(), lang) : demoData(new Date(), lang)));
        setLoaded(true);
        // &whatsnew: the launch notes as the next release will show them.
        if (DEMO.has("whatsnew")) loadChangelog().then((all) => setWhatsNew({ entries: allNotes(all, true).slice(0, 1), launch: true }));
        return;
      }
      let stored = null;
      try {
        const r = await window.storage.get(STORAGE_KEY);
        stored = r?.value ?? null;
        if (stored) {
          const raw = JSON.parse(stored);
          const migrated = hydrate(migrate(raw));
          setData(migrated);
          if (migrated !== raw) {
            try { await window.storage.set(STORAGE_KEY, JSON.stringify(migrated)); } catch { /* migration re-runs next load if this fails */ }
          }
        } else {
          // Persist immediately rather than holding defaults in memory, so the
          // data file exists from first launch instead of first edit.
          await save(hydrate(defaultData()), { undoable: false });
          setSetupOpen(true);
        }
      } catch (err) {
        // The budget is there but won't open - damaged, or a format this
        // version can't convert. Carrying on with an empty budget would let
        // the first edit save over it, so stop and let the user choose.
        const keptAs = err?.keptAs || (stored ? await setAsideUnreadable(stored) : null);
        setLoadError({ keptAs, message: String(err?.message || err) });
        return;
      }
      setLoaded(true);
      whatsNewAtLaunch(!!stored).then((entries) => { if (entries.length) setWhatsNew({ entries, launch: true }); }).catch(() => { /* notes are a courtesy */ });
    })();
    // `save` has no deps of its own, so this still runs exactly once.
  }, [save]);

  useEffect(() => {
    if (!pendingDelete) return;
    const t = setTimeout(() => setPendingDelete(null), 3000);
    return () => clearTimeout(t);
  }, [pendingDelete]);

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, themeMode); } catch { /* theme falls back to dark next launch */ }
  }, [themeMode]);

  const themedValue = useMemo(() => {
    const theme = themeMode === "dark" ? DARK_THEME : LIGHT_THEME;
    return { theme, s: makeStyles(theme) };
  }, [themeMode]);
  const { theme, s } = themedValue;

  const patchMonth = useCallback((key, patch) => {
    const m = data.months[key] || emptyMonth();
    // An edit to an already-closed period is a retroactive correction, so stamp
    // it. The Savings table surfaces this, otherwise a hand-corrected figure is
    // indistinguishable from a calculated one months later. ISO-UTC is right
    // here: this is an instant, not a calendar day.
    const closed = key < calendarFor(data).current();
    save({
      ...data,
      months: {
        ...data.months,
        [key]: { ...m, ...patch, ...(closed ? { editedAt: new Date().toISOString() } : {}) },
      },
    });
  }, [data, save]);

  const patchCur = useCallback((patch) => {
    patchMonth(calendarFor(data).current(), patch);
  }, [patchMonth, data]);

  // Applied during render so every fmt() and t() below this line uses the
  // chosen currency and language, including the ones inside helpers called
  // from the JSX.
  setMoneyFormat(data.currency, data.locale || navigator.language || "en-US");
  setLanguage(data.language);
  setLabelLocale(dateLocale());

  const deleteArm = useMemo(() => ({ armedId: pendingDelete, arm: setPendingDelete }), [pendingDelete]);

  // ensureCurrentMonth used to run only inside hydrate(), i.e. only at launch.
  // Since the app lives in the tray it can sit running across a period boundary,
  // so a new period was never created and the recurring and credit templates
  // never copied in. Worse, both `cur` and patchMonth fall back to emptyMonth(),
  // so the first edit in the new period would persist that empty month and lose
  // the templates for good. Re-running it on every date tick closes that window.
  useEffect(() => {
    if (!loaded) return;
    const rolled = ensureCurrentMonth(data);
    if (rolled !== data) save(rolled, { undoable: false });
  }, [loaded, todayKey, data, save]);

  // What's due now sits at the top of Upcoming; a clicked reminder lands there.
  const openDueSoon = useCallback(() => setTab("upcoming"), []);
  useReminders(data, loaded, setTodayKey, openDueSoon);
  const updater = useUpdater(data.updates?.auto !== false, loaded);

  // "Start with Windows" is a login entry holding the app's path, and that path
  // moves when the installer does (0.5.0 moved from a per-machine .msi to a
  // per-user setup). Rewriting it at each launch keeps it pointing at this copy.
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      try {
        const a = await import("@tauri-apps/plugin-autostart");
        if (await a.isEnabled()) await a.enable();
      } catch { /* the setting still shows its real state in Settings */ }
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  const restore = useCallback(async (from, to, label) => {
    const h = historyRef.current;
    if (!h[from].length) { setToast(label === "Undo" ? t("Nothing to undo") : t("Nothing to redo")); return; }
    const target = h[from].pop();
    h[to].push(dataRef.current);
    h.lastPushAt = 0; // the next edit starts a fresh undo step
    setHistorySize({ past: h.past.length, future: h.future.length });
    setData(target);
    try { await persist(target); } catch { /* in-memory state still updated */ }
    setToast(label === "Undo" ? t("Undone") : t("Redone"));
  }, []);
  const undo = useCallback(() => restore("past", "future", "Undo"), [restore]);
  const redo = useCallback(() => restore("future", "past", "Redo"), [restore]);

  // Desktop shortcuts. Ctrl/Cmd+Z, Shift+Ctrl+Z or Ctrl+Y, Ctrl+1-9 for tabs;
  // N for a new entry and / for search when not typing. Nothing fires behind an
  // open dialog, and undo leaves text fields alone so their own undo works.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const tag = (el?.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable;
      const dialogOpen = !!modal || settingsOpen || categoriesOpen || statementOpen || searchOpen || rulesOpen || setupOpen || !!pinDialog || !!payDialog || !!whatsNew;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Locking works from anywhere, open dialog or not.
      if (mod && key === "l" && lockCfg) { e.preventDefault(); setLocked(true); return; }
      // Locked means locked: no undo, redo or anything else behind the lock screen.
      if (lockCfg && locked) return;
      if (!loaded || dialogOpen) return;
      if (mod && key === "f") { e.preventDefault(); setSearchOpen(true); return; }
      if (mod && key === "z" && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && key === "y" && !typing) { e.preventDefault(); redo(); return; }
      if (mod && /^[0-9]$/.test(e.key)) {
        // Ctrl+0 is the tenth tab, as on a keyboard's number row.
        const target = TABS[e.key === "0" ? 9 : Number(e.key) - 1];
        if (target) { e.preventDefault(); setTab(target.id); if (target.id !== "history") setHistoryKey(null); }
        return;
      }
      if (typing || mod || e.altKey) return;
      if (key === "n" && ADD_LABELS[tab]) { e.preventDefault(); setModal({ type: MODAL_FOR_TAB[tab] || tab }); return; }
      if (key === "/") {
        const search = document.querySelector("main input[data-tab-search]");
        if (search) { e.preventDefault(); search.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loaded, modal, settingsOpen, categoriesOpen, statementOpen, searchOpen, rulesOpen, setupOpen, pinDialog, payDialog, whatsNew, lockCfg, locked, tab, undo, redo]);

  useEffect(() => {
    let alive = true;
    readLock().then((cfg) => { if (!alive) return; setLockCfg(cfg); setLocked(!!cfg); });
    return () => { alive = false; };
  }, []);

  // Lock after a spell of not using the app.
  useEffect(() => {
    if (!lockCfg || locked || !(lockCfg.idleMinutes > 0)) return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ["pointerdown", "pointermove", "keydown", "wheel"];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const iv = setInterval(() => { if (Date.now() - last > lockCfg.idleMinutes * 60000) setLocked(true); }, 15000);
    return () => { events.forEach((ev) => window.removeEventListener(ev, bump)); clearInterval(iv); };
  }, [lockCfg, locked]);

  // And when the window is minimised or hidden to the tray.
  useEffect(() => {
    if (!lockCfg || lockCfg.lockWhenHidden === false) return;
    const onVis = () => { if (document.visibilityState === "hidden") setLocked(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [lockCfg]);

  // Derived from todayKey rather than recomputed per render: stable within a
  // day, and guaranteed to refresh when the tick above crosses midnight. Local
  // midnight is also the right value for the day-granularity comparisons in
  // isRecurringDue, which treat period bounds as whole days.
  const today = useMemo(() => new Date(`${todayKey}T00:00:00`), [todayKey]);

  if ((!loaded && !loadError) || lockCfg === undefined) return <div style={s.shell}><div style={{ color: theme.textFaint, textAlign: "center", marginTop: 200, fontSize: 14 }}>{t("Loading...")}</div></div>;

  if (lockCfg && locked) {
    return (
      <ThemeContext.Provider value={themedValue}>
        {/* The window has no system title bar, so the lock screen keeps the
            app's own: it can still be moved, minimised and closed. */}
        <div data-tauri-drag-region style={{ position: "fixed", top: 0, left: 0, right: 0, height: 40, zIndex: 2 }}>
          <WindowControls />
        </div>
        <LockScreen lock={lockCfg} onUnlock={() => setLocked(false)} />
      </ThemeContext.Provider>
    );
  }

  if (loadError) {
    // A chosen budget replaces the unreadable one; only now is anything saved.
    const adopt = async (next) => {
      await save(next, { undoable: false });
      setLoadError(null);
      setLoaded(true);
    };
    const adoptText = async (text) => {
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || !parsed.months || typeof parsed.months !== "object") throw new Error("not a budget");
        await adopt(hydrate(migrate(parsed)));
      } catch {
        alert(t("That backup could not be read."));
      }
    };
    return (
      <ThemeContext.Provider value={themedValue}>
        <div data-tauri-drag-region style={{ position: "fixed", top: 0, left: 0, right: 0, height: 40, zIndex: 2 }}>
          <WindowControls />
        </div>
        <RecoveryScreen keptAs={loadError.keptAs} error={loadError.message}
          onRestoreBackup={async (name) => {
            let text;
            try { text = await readBackup(name); } catch { alert(t("That backup could not be read.")); return; }
            await adoptText(text);
          }}
          onOpenFile={adoptText}
          onStartNew={async () => {
            if (!confirm(t("Start a new, empty budget? The unreadable budget and your backups are kept."))) return;
            await adopt(hydrate(defaultData()));
            setSetupOpen(true);
          }} />
      </ThemeContext.Provider>
    );
  }

  const cal = calendarFor(data);
  const curKey = cal.current();
  const cur = data.months[curKey] || emptyMonth();

  // Every spending and income figure on screen comes from these two. Nothing
  // below re-sums entries, or the cards and charts drift apart again.
  const spending = periodSpending(cur, curKey, today, cal);
  const income = periodIncome(cur, curKey, today, cal);
  const totalExpenses = spending.expenses;
  const totalRecurringAll = cur.recurring.reduce((a, e) => a + e.amount, 0);
  const totalRecurringFuture = totalRecurringAll - spending.recurring;
  const totalUnpaidUpcoming = cur.upcoming.filter((u) => !upcomingSettled(u, today)).reduce((a, e) => a + e.amount, 0);
  const isReceived = (c) => creditReceived(c, curKey, today, cal);
  const totalCredits = income.credits;
  const totalCreditsPending = income.pending;
  const effectiveIncome = income.total;
  const totalActuallySpent = spending.total;
  const totalStillScheduled = totalRecurringFuture + totalUnpaidUpcoming;
  const totalCommitted = totalActuallySpent;
  const availableAfterCommitted = Math.max(0, effectiveIncome - totalCommitted);
  const savingsGoal = data.savingsGoal || { monthly: 0 };
  // Kept per month, set aside per period: a fortnight sets aside 12/26 of it.
  const setAside = perPeriodOf(savingsGoal.monthly, cal, curKey);
  // Store what was typed, apply what the period can actually cover - the same
  // split the percentage version used, so a lean month cannot silently rewrite
  // the goal. The gap is surfaced rather than hidden.
  const savingsTarget = Math.min(setAside, availableAfterCommitted);
  const savingsShortfall = Math.max(0, setAside - availableAfterCommitted);
  const leftToSpend = Math.max(0, availableAfterCommitted - savingsTarget);
  const remaining = effectiveIncome - totalCommitted;
  // Only bills due THIS period can be missing from it. Without the cycle check a
  // yearly bill would be reported missing in the eleven periods it is not due.
  // A weekly one is missing any of its dates the period has no copy for.
  const missingRecurring = (data.recurringTemplate || []).filter(
    (tpl) => missingCopies(tpl, cal, curKey, cur.recurring, uid).length > 0);
  const missingCredits = (data.creditTemplate || []).filter(
    (tpl) => missingCopies(tpl, cal, curKey, cur.credits, uid).length > 0);
  const offCycleRecurring = (data.recurringTemplate || []).filter((tpl) => !occursIn(tpl, cal, curKey));
  const offCycleCredits = (data.creditTemplate || []).filter((tpl) => !occursIn(tpl, cal, curKey));
  const reminderLeadDays = Number.isFinite(data.reminders?.leadDays) ? data.reminders.leadDays : 3;
  // Exactly what a reminder would fire for, so the notification and the screen
  // can never disagree about what is due.
  const dueBills = collectDueBills(data, today, reminderLeadDays, Infinity);
  const totalUpcoming = totalUnpaidUpcoming;

  const leftOver = leftOverHistory(data, today);
  const goals = data.goals || [];
  const goalStatuses = goals.map((g) => goalStatus(g, data, today, leftOver));
  const goalsSaved = goalStatuses.reduce((a, st) => a + (st.saved || 0), 0);
  const goalsTarget = goalStatuses.reduce((a, st) => a + (st.target || 0), 0);
  const goalsNeed = goalsMonthlyNeed(goals, data, today);
  const regular = findRegularPayments(data, today);
  const fc = forecast(data, curKey, today);
  const fcDay = (iso) => fmtDate(iso, { day: "numeric", month: "short" });
  const spentByCat = spending.byCategory;
  const onSortExpenses = (col, shift) =>
    setExpensesView((v) => ({ ...v, sorts: toggleSort(v.sorts || [], col, shift) }));
  const filteredExpenses = filterAndSort(cur.expenses, expensesView);
  const onSortRecurring = (col, shift) =>
    setRecurringView((v) => ({ ...v, sorts: toggleSort(v.sorts || [], col, shift) }));
  const filteredRecurring = filterAndSort(cur.recurring, recurringView);
  const onSortUpcoming = (col, shift) =>
    setUpcomingView((v) => ({ ...v, sorts: toggleSort(v.sorts || [], col, shift) }));
  const filteredUpcoming = filterAndSort(cur.upcoming, upcomingView);
  const onSortCredits = (col, shift) =>
    setCreditsView((v) => ({ ...v, sorts: toggleSort(v.sorts || [], col, shift) }));
  const filteredCredits = filterAndSort(cur.credits || [], creditsView);
  const onChangeCutoff = (next) => {
    const clamped = Math.max(1, Math.min(28, next || 1));
    // A budget with a pay schedule changes payday by adding to the schedule,
    // never by re-sorting its months.
    if (cal.scheduled) { setPayDialog({ kind: "monthly", cutoffDay: clamped }); return; }
    if (clamped === cal.cutoffDay) return;
    const moves = countRebucketMoves(data, clamped, today);
    if (moves === 0) { save({ ...data, cutoffDay: clamped }); return; }
    const ok = confirm(
      tn(moves, "Move {n} entry to match the new start day?", "Move {n} entries to match the new start day?") + "\n\n" +
      t("Expenses, one-off credits, upcoming payments and weekly items will move to the period their date falls in. Monthly recurring items and income stay where they are.") + "\n\n" +
      t("Choose Cancel to change the start day without moving anything.")
    );
    save(ok ? { ...rebucketData(data, clamped, today), cutoffDay: clamped } : { ...data, cutoffDay: clamped });
  };

  // A switch of pay schedule: a backup of the budget as it was, then one
  // save, so Ctrl+Z undoes it.
  const onSwitchSchedule = async (next) => {
    if (isTauri) {
      try {
        const current = await window.storage.get(STORAGE_KEY);
        if (current?.value) await writeBackup(current.value, "before-pay-schedule");
      } catch { /* never block the switch on a failed snapshot */ }
    }
    save(next);
    setPayDialog(null);
  };

  // Budget and rollover change together, as one undo step. A budget change
  // applies from this period on; earlier periods keep the budget they had.
  const onSetBudget = (name, newCap, rollover) => {
    save({
      ...data,
      categories: data.categories.map((c) => {
        if (c.name !== name) return c;
        const capped = capAt(c, curKey) === newCap ? c : withCap(c, newCap, curKey);
        return withRollover(capped, rollover, curKey);
      }),
    });
  };
  const todayISO = isoDay(today);
  const installUpdate = () => updater.install(async (version) => {
    const current = await window.storage.get(STORAGE_KEY);
    if (current?.value) await writeBackup(current.value, `before-update-${version}`);
  });
  const accounts = data.accounts || [];
  const saveAccounts = (next) => save({ ...data, accounts: next });
  const onRecordBalance = (id, entry) => saveAccounts(accounts.map((a) => (a.id === id ? recordBalance(a, entry) : a)));
  const onRemoveBalance = (id, date) => saveAccounts(accounts.map((a) => (a.id === id ? removeBalance(a, date) : a)));

  const onStartFresh = (name) => {
    save({ ...data, categories: data.categories.map((c) => (c.name === name ? startFresh(c, curKey) : c)) });
  };

  return (
    <ThemeContext.Provider value={themedValue}>
    <DeleteArmContext.Provider value={deleteArm}>
    <div style={s.shell}>
      <style>{`
        *[data-tauri-drag-region] { app-region: drag; -webkit-app-region: drag; }
        *[data-tauri-drag-region] button,
        *[data-tauri-drag-region] input,
        *[data-tauri-drag-region] select,
        *[data-tauri-drag-region] a { app-region: no-drag; -webkit-app-region: no-drag; }

        /* Scrollbars follow the theme. color-scheme also darkens the number-input
           spinners and any other native control the panels render. */
        :root { color-scheme: ${themeMode === "dark" ? "dark" : "light"}; }
        /* A dropdown's list is drawn by the system, which can't see the
           translucent field behind it. Without a solid colour of its own it
           came out white, under the theme's light dark-mode text. */
        select option, select optgroup { background-color: ${theme.surface}; color: ${theme.text}; }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${theme.border}; border-radius: 5px; }
        ::-webkit-scrollbar-thumb:hover { background: ${theme.textFaint}; }
        ::-webkit-scrollbar-corner { background: transparent; }

        /* Interaction states: buttons press in slightly, and keyboard focus
           shows a violet ring. */
        button, input, select, textarea { font-family: inherit; }
        button { transition: transform .12s ease, background-color .2s ease, color .2s ease, opacity .2s ease, border-color .2s ease; }
        button:active:not(:disabled) { transform: scale(0.97); }
        :focus-visible { outline: 2px solid ${FOCUS_RING}; outline-offset: 2px; }
        .icon-btn:hover { background: ${theme.hover} !important; }
        .nav-item:hover { color: ${theme.outerText} !important; background: ${theme.hover}; }
        .add-btn:hover { background: ${theme.addBgHover} !important; }
        .search-pill:hover { border-color: ${theme.addBorder} !important; }
        .row-hover:hover { background: ${theme.hover}; }

        /* The soft colour glows behind everything, drifting slowly. */
        .ambient { position: absolute; z-index: -1; inset: -34% -28% -28% -12%; pointer-events: none;
          background:
            radial-gradient(ellipse 74% 46% at 20% 40%, ${theme.glowA}, transparent 76%),
            radial-gradient(ellipse 78% 50% at 82% 60%, ${theme.glowB}, transparent 78%),
            radial-gradient(circle at 74% 2%, ${theme.glowC}, transparent 25%);
          filter: blur(88px); animation: ambient-drift 38s ease-in-out infinite alternate; }
        @keyframes ambient-drift {
          0% { transform: translate3d(-2%, -1%, 0) scale(.98) rotate(-1deg); }
          50% { transform: translate3d(2.5%, 1.5%, 0) scale(1.025) rotate(.6deg); }
          100% { transform: translate3d(-.5%, 3%, 0) scale(1.01) rotate(-.4deg); }
        }
        @media (prefers-reduced-motion: reduce) { .ambient { animation: none; } }
        ${isLinux ? ".ambient { animation: none; }" : ""}

        /* Dashboard rows, after the design. As the window narrows, the side
           card is squeezed to the narrowest it reads well at, and only then
           wraps below - by the space the cards have, not the window's width.
           useReflowAnimation makes the move glide rather than jump. */
        .dash-top, .dash-lower { position: relative; display: flex; flex-wrap: wrap; gap: 18px; }
        .dash-lower { margin-top: 18px; }
        .dash-top > *, .dash-lower > * { min-width: 0; box-sizing: border-box; }
        .dash-top > :first-child { flex: 2 1 480px; }
        .dash-top > :last-child { flex: 1 1 280px; }
        .dash-lower > :first-child { flex: 3 1 380px; }
        .dash-lower > :last-child { flex: 2 1 300px; }
        .dash-plan { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, .95fr) minmax(0, 1.5fr); gap: 28px; align-items: start; }
        @media (max-width: 1180px) {
          .dash-plan { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
          .dash-plan > :last-child { grid-column: 1 / -1; }
        }

        /* Inline-editable cells read as text until you reach for them. */
        .inline-edit { border: 1px solid transparent; transition: border-color .15s ease, background-color .15s ease; }
        .inline-edit:hover { border-color: ${theme.border}; }
        .inline-edit:focus { border-color: ${FOCUS_RING}; background: ${theme.bg} !important; }
      `}</style>

      <div className="ambient" aria-hidden="true" />

      {/* SIDEBAR */}
      <aside style={s.sidebar}>
        <div data-tauri-drag-region style={s.logo}>
          <BrandMark />
          <span data-tauri-drag-region style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.7, color: theme.outerText, whiteSpace: "nowrap" }}>Budget Ctrl</span>
        </div>
        <nav style={s.nav}>
          {TABS.map((tb) => {
            const active = tab === tb.id;
            return (
              <button key={tb.id} className={active ? undefined : "nav-item"} onClick={() => { setTab(tb.id); if (tb.id !== "history") setHistoryKey(null); }}
                style={active ? { ...s.navItem, ...s.navItemActive } : s.navItem} aria-current={active ? "page" : undefined}>
                <Icon name={tb.icon} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(tb.label)}</span>
                {tb.id === "upcoming" && dueBills.length > 0
                  ? <span style={s.badge} title={t("Due soon or overdue")}>{dueBills.length}</span>
                  : active && <span style={{ marginLeft: "auto", width: 5, height: 5, borderRadius: "50%", background: theme.accent, flex: "none" }} />}
              </button>
            );
          })}
        </nav>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${theme.outerBorder}`, paddingTop: SPACE.sm, marginTop: SPACE.md }}>
          {lockCfg && (
            <button className="nav-item" style={s.navItem} onClick={() => setLocked(true)} title={t("Lock now (Ctrl+L)")}>
              <Icon name="lock" /><span>{t("Lock")}</span>
            </button>
          )}
          <button className="nav-item" style={s.navItem} onClick={() => setSettingsOpen(true)}>
            <Icon name="sliders" /><span>{t("Settings")}</span>
          </button>
        </div>
        <input type="file" accept=".json" ref={importInputRef} onChange={onImportFile} style={{ display: "none" }} />
      </aside>

      {/* MAIN */}
      <main style={s.main}>
        <header data-tauri-drag-region style={{ ...s.topbar, position: "relative", paddingTop: isTauri ? 40 : 20 }}>
          <WindowControls />
          {/* The whole bar drags; interactive children opt out via app-region: no-drag */}
          <div data-tauri-drag-region style={{ flex: 1, minWidth: 0, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <span data-tauri-drag-region style={{ ...TYPE.navLink, textTransform: "uppercase", color: theme.outerTextMuted, marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {fmtDate(new Date(), { weekday: "long", day: "numeric", month: "long" })}
              {!cal.calendarMonths && ` · ${t("period {range}", { range: cal.label(curKey).range || cal.label(curKey).primary })}`}
            </span>
            <h1 data-tauri-drag-region style={{ ...TYPE.tagline, margin: 0, color: theme.outerText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {tab === "dashboard" ? greeting(new Date()) : t(TABS.find((tb) => tb.id === tab)?.label || "")}
            </h1>
          </div>
          {/* One right-hand group in normal flow: the Add CTA plus the two icon
              controls, sharing a baseline and ending flush at the edge. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <button className="search-pill" onClick={() => setSearchOpen(true)} title={t("Search everything (Ctrl+F)")}
              style={{ width: 215, height: 40, padding: "0 11px", display: "flex", alignItems: "center", gap: 8, border: `1px solid ${theme.outerBorder}`,
                       borderRadius: 14, background: theme.bg, color: theme.textSoft, cursor: "pointer", fontSize: 13, fontFamily: FONT }}>
              <Icon name="search" size={17} />
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("Search everything")}</span>
              <kbd style={{ padding: "2px 5px", border: `1px solid ${theme.outerBorder}`, borderRadius: 4, fontSize: 10, fontFamily: FONT, whiteSpace: "nowrap" }}>Ctrl F</kbd>
            </button>
            <button
              className="icon-btn"
              style={{ ...s.themeToggle, opacity: historySize.past ? 1 : 0.35, cursor: historySize.past ? "pointer" : "default" }}
              disabled={!historySize.past}
              onClick={undo}
              title={t("Undo (Ctrl+Z)")}
            ><Icon name="undo" size={17} /></button>
            <button
              className="icon-btn"
              style={s.themeToggle}
              onClick={() => setThemeMode((m) => m === "dark" ? "light" : "dark")}
              title={themeMode === "dark" ? t("Switch to light panel") : t("Switch to dark panel")}
            ><Icon name={themeMode === "dark" ? "sun" : "moon"} size={17} /></button>
            <button className="icon-btn" style={s.themeToggle} onClick={() => setTab("upcoming")}
              title={dueBills.length ? t("Due soon or overdue") : t("Nothing due soon")}>
              <Icon name="bell" size={17} />
              {dueBills.length > 0 && <span style={{ position: "absolute", top: 8, right: 9, width: 6, height: 6, borderRadius: "50%", background: theme.danger, boxShadow: `0 0 0 2px ${theme.canvas}` }} />}
            </button>
            {ADD_LABELS[tab] && (
              <button className="add-btn" style={s.addBtn} onClick={() => setModal({ type: MODAL_FOR_TAB[tab] || tab })}>
                <Icon name="plus" size={16} />
                {t(ADD_LABELS[tab]).replace(/^\+\s*/, "")}
              </button>
            )}
          </div>
        </header>

        <div style={s.content}>
          <div style={s.contentInner}>
          <UpdateBanner updater={updater} onInstall={installUpdate} />
          {/* DASHBOARD */}
          {tab === "dashboard" && (
            <Dashboard
              data={data} cur={cur} curKey={curKey} today={today} cal={cal} fc={fc}
              remaining={remaining}
              remainingSub={fc.series.length < 2 || fc.lowestWithEveryday.date === fc.series[0].date
                // Nothing ahead brings it lower than now: no dip worth naming.
                ? (totalStillScheduled > 0 ? t("{amount} still scheduled", { amount: fmt(totalStillScheduled) }) : t("Everything's landed"))
                : t("Lowest ahead {amount} on {date}", { amount: fmt(fc.lowestWithEveryday.amount), date: fcDay(fc.lowestWithEveryday.date) })}
              totalUpcoming={totalUpcoming} totalActuallySpent={totalActuallySpent} totalStillScheduled={totalStillScheduled}
              goals={goals} goalsSaved={goalsSaved} goalsTarget={goalsTarget} goalsNeed={goalsNeed}
              dueBills={dueBills} totalCredits={totalCredits} totalCreditsPending={totalCreditsPending}
              savingsGoal={savingsGoal} setAside={setAside} savingsShortfall={savingsShortfall} savingsTarget={savingsTarget} leftToSpend={leftToSpend}
              effectiveIncome={effectiveIncome} spentByCat={spentByCat} isReceived={isReceived}
              onSetTab={setTab} onEdit={setModal} patchCur={patchCur} save={save}
              onManageCategories={() => setCategoriesOpen(true)} onSetBudget={onSetBudget} onStartFresh={onStartFresh} />
          )}

          {/* EXPENSES */}
          {/* Due soon and overdue, above the period's payments: what a reminder
              would fire for, recurring bills included, from any period. */}
          {tab === "upcoming" && dueBills.length > 0 && (
            <div style={{ ...s.card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>{t("Due soon and overdue")}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.warning, fontSize: 16 }}>
                  {fmt(dueBills.reduce((a, b) => a + b.amount, 0))}
                </div>
              </div>
              <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginBottom: 4 }}>
                {tn(reminderLeadDays, "Everything a reminder would fire for: due within {n} day, plus anything still unpaid past its date. Entries marked {paysItself} are excluded.",
                  "Everything a reminder would fire for: due within {n} days, plus anything still unpaid past its date. Entries marked {paysItself} are excluded.",
                  { paysItself: <em key="p">{t("pays itself")}</em> })}
                {" "}<button style={{ ...s.linkBtn, padding: 0, ...TYPE.finePrint, fontWeight: 600 }} onClick={() => setSettingsOpen(true)}>{t("Change the window")}</button>
              </div>
              {(
                <>
                  <TableHeader columns={[
                    { label: tk("NAME"), flex: 2 }, { label: tk("TYPE"), flex: 0.9 },
                    { label: tk("DUE"), flex: 1 }, { label: tk("WHEN"), flex: 1 },
                    { label: tk("AMOUNT"), flex: 1, align: "right" }, { label: "", flex: 1.1, align: "right" },
                  ]} />
                  {dueBills.map((b) => (
                    <div key={b.id} style={s.tableRow}>
                      <div style={{ flex: 2, fontWeight: 600 }}>{b.name}</div>
                      <div style={{ flex: 0.9, color: theme.textMuted, ...TYPE.finePrint, lineHeight: 1.5 }}>
                        {b.kind === "recurring" ? t("Recurring") : t("Upcoming")}
                        {/* Reminders scan every period, but the Upcoming tab only
                            shows the current one - so an item left unpaid in an
                            earlier period was invisible while still nagging.
                            Naming its period makes that obvious. */}
                        {b.periodKey !== curKey && (
                          <span style={{ display: "block", color: theme.danger }}>
                            {t("from {period}", { period: cal.label(b.periodKey).primary })}
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, color: theme.textMuted, ...TYPE.caption }} title={b.dueISO}>{shortDate(b.dueISO)}</div>
                      <div style={{ flex: 1, ...TYPE.caption, color: b.inDays < 0 ? theme.danger : b.inDays === 0 ? theme.warning : theme.textMuted }}>
                        {due(b.inDays)}
                        {b.inDays < -OVERDUE_GRACE_DAYS && (
                          <span title={t("Older than {n} days, so reminders no longer mention it", { n: OVERDUE_GRACE_DAYS })}
                                style={{ display: "block", ...TYPE.microLegal, color: theme.textFaint }}>{t("not in reminders")}</span>
                        )}
                      </div>
                      <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.warning }}>{fmt(b.amount)}</div>
                      <div style={{ flex: 1.1, textAlign: "right", display: "flex", gap: SPACE.sm, justifyContent: "flex-end" }}>
                        {b.kind === "upcoming" && (
                          <button style={{ ...s.linkBtn, padding: 0 }}
                            onClick={() => {
                              const mk = b.periodKey;
                              const mm = data.months[mk] || emptyMonth();
                              patchMonth(mk, { upcoming: mm.upcoming.map((x) => x.id === b.entryId ? { ...x, paid: true } : x) });
                            }}>{t("Mark paid")}</button>
                        )}
                        <button style={{ ...s.linkBtn, padding: 0 }}
                          onClick={() => setModal({ type: b.kind === "recurring" ? "recurring" : "upcoming", editId: b.entryId, monthKey: b.periodKey })}>{t("Edit")}</button>
                      </div>
                    </div>
                  ))}
                  <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: SPACE.md }}>
                    {t("Something here that pays itself? Open it and tick {paysItself} — it will settle on its own date and stop reminding.", { paysItself: <em key="p">{t("Pays itself")}</em> })}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "expenses" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
                  <div style={s.cardTitle}>{t("All Expenses")}</div>
                  <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setStatementOpen(true)}>{t("Import from bank")}</button>
                </div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.danger, fontSize: 16 }}>{t("Total: {amount}", { amount: fmt(totalExpenses) })}</div>
              </div>
              <input
                type="text"
                data-tab-search placeholder={t("Search expenses...")}
                value={expensesView.search}
                onChange={(e) => setExpensesView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredExpenses.length === 0 ? <div style={s.empty}>{expensesView.search ? t("No expenses match \"{search}\".", { search: expensesView.search }) : t("No expenses yet. Click \"+ Add Expense\" to start tracking.")}</div> : (
                <>
                  <TableHeader columns={ENTRY_COLUMNS.expenses} sorts={expensesView.sorts} onSort={onSortExpenses} />
                  {filteredExpenses.map((e) => (
                    <ExpenseRow key={e.id} entry={e} categories={data.categories}
                      onEdit={() => setModal({ type: "expense", editId: e.id })}
                      onDelete={() => patchCur({ expenses: cur.expenses.filter((x) => x.id !== e.id) })} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* RECURRING */}
          {tab === "recurring" && regular.length > 0 && (
            <div style={{ ...s.card, marginBottom: 16 }}>
              <div style={s.cardTitle}>{t("Looks like a monthly bill")}</div>
              <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: SPACE.xs }}>{t("Paid about the same amount, on about the same day, in each of the last few months. Make it recurring and it's counted for you every month; this month's payment becomes this month's bill, so nothing is counted twice.")}</div>
              {regular.map((g) => (
                <div key={g.key} style={{ ...s.tableRow, gap: SPACE.md }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{g.name}</div>
                    <div style={{ ...TYPE.finePrint, color: theme.textFaint }}>
                      {t("Around the {day}", { day: ordinal(g.dayOfMonth) })} · {g.months.map((k) => monthShort(k)).join(", ")} · {g.category}
                    </div>
                  </div>
                  <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(g.amount)}</div>
                  <button style={{ ...s.addBtn, padding: "7px 14px" }} onClick={() => {
                    save(convertToRecurring(data, g, uid, today).data);
                    setToast(t("{name} is now a recurring bill", { name: g.name }));
                  }}>{t("Make recurring")}</button>
                  <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => save(dismissRegular(data, g.key))}
                    title={t("Stop suggesting this one")}>{t("Not a bill")}</button>
                </div>
              ))}
            </div>
          )}

          {tab === "recurring" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>{t("Recurring Payments")}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.accent, fontSize: 16 }}>{t("This period: {amount}", { amount: fmt(totalRecurringAll) })}</div>
              </div>
              <MissingFromTemplate
                missing={missingRecurring}
                kind="recurring"
                onAdd={() => patchCur({ recurring: [...cur.recurring, ...missingRecurring.flatMap((tpl) => missingCopies(tpl, cal, curKey, cur.recurring, uid))] })}
              />
              <input
                type="text"
                data-tab-search placeholder={t("Search recurring...")}
                value={recurringView.search}
                onChange={(e) => setRecurringView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredRecurring.length === 0 ? <div style={s.empty}>{recurringView.search ? t("No recurring items match \"{search}\".", { search: recurringView.search }) : offCycleRecurring.length ? t("Nothing recurring is due this period.") : t("No recurring payments set up. Click \"+ Add Recurring\" to create one.")}</div> : (
                <>
                  <TableHeader columns={ENTRY_COLUMNS.recurring} sorts={recurringView.sorts} onSort={onSortRecurring} />
                  {filteredRecurring.map((r) => (
                    <RecurringRow key={r.id} entry={r} categories={data.categories} dated={cal.dated(curKey)}
                      onEdit={() => setModal({ type: "recurring", editId: r.id })}
                      onDelete={() => save(deleteRecurringCopy(data, "recurring", curKey, r))} />
                  ))}
                </>
              )}
              <NotDueThisPeriod items={offCycleRecurring} curKey={curKey} cal={cal} categories={data.categories}
                onEdit={(tpl) => setModal({ type: "recurring", templateId: tpl.id })}
                onDelete={(tpl) => save(deleteTemplate(data, "recurring", curKey, tpl.id))} />
            </div>
          )}

          {/* UPCOMING */}
          {tab === "upcoming" && (
            <>
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={s.cardTitle}>{cal.calendarMonths ? t("Money left this month, looking ahead") : t("Money left this period, looking ahead")}</div>
                <ForecastCard fc={fc} monthly={cal.calendarMonths} />
              </div>
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={s.cardTitle}>{t("Calendar")}</div>
                <BillCalendar data={data} periodKey={curKey} today={today}
                  onOpen={(it) => setModal({ type: editFormFor(it.kind, (cur.credits || []).find((c) => c.id === it.id)), editId: it.id, monthKey: curKey })} />
              </div>
            </>
          )}

          {tab === "upcoming" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>{t("Upcoming Payments")}</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.warning, fontSize: 16 }}>{t("Owed: {amount}", { amount: fmt(totalUpcoming) })}</div>
              </div>
              <input
                type="text"
                data-tab-search placeholder={t("Search upcoming...")}
                value={upcomingView.search}
                onChange={(e) => setUpcomingView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredUpcoming.length === 0 ? <div style={s.empty}>{upcomingView.search ? t("No upcoming items match \"{search}\".", { search: upcomingView.search }) : t("No upcoming payments. Click \"+ Add Payment\" to schedule one.")}</div> : (
                <>
                  <TableHeader columns={ENTRY_COLUMNS.upcoming} sorts={upcomingView.sorts} onSort={onSortUpcoming} />
                  {filteredUpcoming.map((u) => (
                    <UpcomingRow key={u.id} entry={u} categories={data.categories} today={today}
                      onTogglePaid={() => patchCur({ upcoming: cur.upcoming.map((x) => x.id === u.id ? { ...x, paid: !x.paid } : x) })}
                      onEdit={() => setModal({ type: "upcoming", editId: u.id })}
                      onDelete={() => patchCur({ upcoming: cur.upcoming.filter((x) => x.id !== u.id) })} />
                  ))}
                </>
              )}
            </div>
          )}

          {/* CREDITS */}
          {tab === "credits" && (() => {
            const recurringCredits = filteredCredits.filter(isRecurringItem);
            const oneOffCredits = filteredCredits.filter((c) => !isRecurringItem(c));
            const creditRow = (c, kind) => (
              <div key={c.id} style={s.tableRow}>
                <EntryName name={c.name} note={c.note} schedule={c} />
                <div style={{ flex: 1.2 }}><CategoryPill categoryName={c.category || c.source} categories={data.creditCategories || []} fallback={CREDIT_UNCATEGORIZED} /></div>
                {kind === "recurring"
                  ? <div style={{ flex: 1, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>{(isWeekly(c) || cal.dated(curKey)) && c.date ? shortDate(c.date) : (c.dayOfMonth || "—")}</div>
                  : <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }} title={c.date}>{shortDate(c.date)}</div>}
                <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: isReceived(c) ? theme.success : theme.textMuted }}>+{fmt(c.amount)}</div>
                <RowActions
                  id={c.id}
                  onEdit={() => setModal({ type: kind === "recurring" ? "creditRecurring" : "credit", editId: c.id })}
                  onDelete={() => {
                    if (kind === "recurring") {
                      save(deleteRecurringCopy(data, "credits", curKey, c));
                    } else {
                      patchCur({ credits: (cur.credits || []).filter((x) => x.id !== c.id) });
                    }
                  }}
                />
              </div>
            );
            return (
              <>
                <div style={s.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={s.cardTitle}>{t("Credits")}</div>
                    <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.success, fontSize: 16 }}>
                      {t("Received: {amount}", { amount: fmt(totalCredits) })}
                      {totalCreditsPending > 0 && <span style={{ color: theme.textMuted, fontSize: 13 }}> · {t("{amount} pending", { amount: fmt(totalCreditsPending) })}</span>}
                    </div>
                  </div>
                  <MissingFromTemplate
                    missing={missingCredits}
                    kind="credit"
                    onAdd={() => patchCur({ credits: [...(cur.credits || []), ...missingCredits.flatMap((tpl) => missingCopies(tpl, cal, curKey, cur.credits, uid))] })}
                  />
                  <input
                    type="text"
                    data-tab-search placeholder={t("Search credits...")}
                    value={creditsView.search}
                    onChange={(e) => setCreditsView((v) => ({ ...v, search: e.target.value }))}
                    style={s.searchInput}
                  />
                </div>

                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>{t("Recurring Credits")}</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "creditRecurring" })}>{t("+ Add")}</button>
                  </div>
                  {recurringCredits.length === 0 ? (
                    <div style={s.emptySmall}>{creditsView.search ? t("No recurring credits match your search.") : t("No recurring credits. Add an allowance, stipend, or retainer.")}</div>
                  ) : (
                    <>
                      <TableHeader columns={[{ label: tk("NAME"), flex: 2, sortKey: "name" }, { label: tk("SOURCE"), flex: 1.2, sortKey: "category" }, { label: tk("DAY"), flex: 1, align: "center", sortKey: "dayOfMonth" }, { label: tk("AMOUNT"), flex: 1, align: "right", sortKey: "amount" }, { label: "", flex: 0.6, align: "center" }]} sorts={creditsView.sorts} onSort={onSortCredits} />
                      {recurringCredits.map((c) => creditRow(c, "recurring"))}
                    </>
                  )}
                  <NotDueThisPeriod items={offCycleCredits} curKey={curKey} cal={cal}
                    categories={data.creditCategories || []} fallback={CREDIT_UNCATEGORIZED} positive
                    onEdit={(tpl) => setModal({ type: "creditRecurring", templateId: tpl.id })}
                    onDelete={(tpl) => save(deleteTemplate(data, "credits", curKey, tpl.id))} />
                </div>

                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>{t("One-off Credits")}</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "credit" })}>{t("+ Add Credit")}</button>
                  </div>
                  {oneOffCredits.length === 0 ? (
                    <div style={s.emptySmall}>{creditsView.search ? t("No one-off credits match your search.") : (cal.calendarMonths ? t("No one-off credits this month. Log a refund, gift, or bonus.") : t("No one-off credits this period. Log a refund, gift, or bonus."))}</div>
                  ) : (
                    <>
                      <TableHeader columns={[{ label: tk("NAME"), flex: 2, sortKey: "name" }, { label: tk("SOURCE"), flex: 1.2, sortKey: "category" }, { label: tk("DATE"), flex: 1, sortKey: "date" }, { label: tk("AMOUNT"), flex: 1, align: "right", sortKey: "amount" }, { label: "", flex: 0.6, align: "center" }]} sorts={creditsView.sorts} onSort={onSortCredits} />
                      {oneOffCredits.map((c) => creditRow(c, "oneoff"))}
                    </>
                  )}
                </div>
              </>
            );
          })()}

          {/* HISTORY - LIST */}
          {tab === "history" && historyKey === null && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={s.cardTitle}>{cal.calendarMonths ? t("Past Months") : t("Past periods")}</div>
              </div>
              {(() => {
                const pastKeys = Object.keys(data.months).filter((k) => k < curKey).sort().reverse();
                if (pastKeys.length === 0) {
                  return <div style={s.empty}>{cal.calendarMonths ? t("No past months yet. Come back after the month ends.") : t("No past periods yet. Come back after this one ends.")}</div>;
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                    {pastKeys.map((k) => {
                      const m = data.months[k];
                      const inc = periodIncome(m, k, today, cal);
                      const credits = inc.credits;
                      const spent = periodSpending(m, k, today, cal).total;
                      const rem = inc.total - spent;
                      const color = rem >= 0 ? theme.success : theme.danger;
                      return (
                        <button key={k} onClick={() => setHistoryKey(k)} style={{
                          background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20,
                          textAlign: "left", cursor: "pointer", display: "grid",
                          gridTemplateColumns: "1.5fr 1fr 1fr 1fr 8px", gap: 16, alignItems: "center",
                          color: theme.text, fontFamily: FONT,
                        }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 16 }}>{cal.label(k).primary}</div>
                            {cal.label(k).range && (
                              <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>{cal.label(k).range}</div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>{t("Income")}</div>
                            <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(m.income)}</div>
                            {credits > 0 && (
                              <div style={{ fontSize: 10, color: theme.success, fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}>+{fmt(credits)}</div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>{t("Spent")}</div>
                            <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.danger }}>{fmt(spent)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>{t("Remaining")}</div>
                            <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color }}>{fmt(rem)}</div>
                          </div>
                          <div style={{ width: 8, height: 40, background: color, borderRadius: 4 }} />
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* HISTORY - DETAIL */}
          {tab === "history" && historyKey !== null && (() => {
            const m = data.months[historyKey] || emptyMonth();
            const spent = periodSpending(m, historyKey, today, cal).total;
            const inc = periodIncome(m, historyKey, today, cal);
            const credits = inc.credits;
            const effective = inc.total;
            const rem = effective - spent;
            return (
              <>
                <button style={{ ...s.linkBtn, marginBottom: 16, fontSize: 14 }} onClick={() => setHistoryKey(null)}>{t("← Back to History")}</button>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>{cal.label(historyKey).primary}</h2>
                {cal.label(historyKey).range && (
                  <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 12 }}>{cal.label(historyKey).range}</div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: theme.textMuted, fontWeight: 600 }}>{t("Income")}</span>
                  <input type="number" value={m.income || ""}
                    onChange={(ev) => patchMonth(historyKey, { income: +ev.target.value || 0 })}
                    placeholder="0" style={{ ...s.input, width: 140 }} />
                  <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
                </div>
                <div style={s.statsRow}>
                  <StatCard label={t("Income")} value={fmt(effective)} accent={theme.success} sub={credits > 0 ? t("+ {amount} credits", { amount: fmt(credits) }) : (cal.calendarMonths ? t("For this month") : t("For this period"))} icon="↑" />
                  <StatCard label={t("Remaining")} value={fmt(rem)} accent={rem >= 0 ? theme.success : theme.danger} sub={t("After everything paid")} icon="↓" />
                  <StatCard label={t("Total Spent")} value={fmt(spent)} accent={theme.danger} sub={t("{oneOff} one-off · {recurring} recurring", { oneOff: m.expenses.length, recurring: m.recurring.length })} icon="↻" />
                </div>
                <div style={s.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>{t("Expenses")}</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "expense", monthKey: historyKey })}>{t("+ Add")}</button>
                  </div>
                  {m.expenses.length === 0 ? <div style={s.emptySmall}>{t("No expenses")}</div> : (
                    <>
                      <TableHeader columns={[{ label: tk("NAME"), flex: 2 }, { label: tk("CATEGORY"), flex: 1.2 }, { label: tk("DATE"), flex: 1 }, { label: tk("AMOUNT"), flex: 1, align: "right" }, { label: "", flex: 0.6, align: "center" }]} />
                      {m.expenses.map((e) => (
                        <ExpenseRow key={e.id} entry={e} categories={data.categories}
                          onEdit={() => setModal({ type: "expense", editId: e.id, monthKey: historyKey })}
                          onDelete={() => patchMonth(historyKey, { expenses: m.expenses.filter((x) => x.id !== e.id) })} />
                      ))}
                    </>
                  )}
                </div>
                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>{t("Recurring")}</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "recurring", monthKey: historyKey })}>{t("+ Add")}</button>
                  </div>
                  {m.recurring.length === 0 ? <div style={s.emptySmall}>{t("No recurring")}</div> : (
                    <>
                      <TableHeader columns={ENTRY_COLUMNS.recurring} />
                      {m.recurring.map((r) => (
                        <RecurringRow key={r.id} entry={r} categories={data.categories} dated={cal.dated(historyKey)}
                          onEdit={() => setModal({ type: "recurring", editId: r.id, monthKey: historyKey })}
                          // Past-period deletion removes only this period's instance -
                          // the live template keeps governing future periods.
                          onDelete={() => patchMonth(historyKey, { recurring: m.recurring.filter((x) => x.id !== r.id) })} />
                      ))}
                    </>
                  )}
                </div>
                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>{t("Upcoming")}</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "upcoming", monthKey: historyKey })}>{t("+ Add")}</button>
                  </div>
                  {m.upcoming.length === 0 ? <div style={s.emptySmall}>{t("No upcoming")}</div> : (
                    <>
                      <TableHeader columns={ENTRY_COLUMNS.upcoming} />
                      {m.upcoming.map((u) => (
                        <UpcomingRow key={u.id} entry={u} categories={data.categories} today={today}
                          onTogglePaid={() => patchMonth(historyKey, { upcoming: m.upcoming.map((x) => x.id === u.id ? { ...x, paid: !x.paid } : x) })}
                          onEdit={() => setModal({ type: "upcoming", editId: u.id, monthKey: historyKey })}
                          onDelete={() => patchMonth(historyKey, { upcoming: m.upcoming.filter((x) => x.id !== u.id) })} />
                      ))}
                    </>
                  )}
                </div>
                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>{t("Credits")}</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "credit", monthKey: historyKey })}>{t("+ Add")}</button>
                  </div>
                  {(m.credits || []).length === 0 ? <div style={s.emptySmall}>{t("No credits")}</div> : (
                    <>
                      <TableHeader columns={[{ label: tk("NAME"), flex: 2 }, { label: tk("SOURCE"), flex: 1.2 }, { label: tk("DATE"), flex: 1 }, { label: tk("AMOUNT"), flex: 1, align: "right" }, { label: "", flex: 0.6, align: "center" }]} />
                      {(m.credits || []).map((c) => (
                        <div key={c.id} style={s.tableRow}>
                          <EntryName name={c.name} note={c.note} schedule={c} />
                          <div style={{ flex: 1.2 }}><CategoryPill categoryName={c.category || c.source} categories={data.creditCategories || []} fallback={CREDIT_UNCATEGORIZED} /></div>
                          <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }} title={c.date}>{shortDate(c.date)}</div>
                          <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.success }}>+{fmt(c.amount)}</div>
                          <RowActions
                            id={c.id}
                            onEdit={() => setModal({ type: editFormFor("credit", c), editId: c.id, monthKey: historyKey })}
                            onDelete={() => patchMonth(historyKey, { credits: (m.credits || []).filter((x) => x.id !== c.id) })}
                          />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </>
            );
          })()}
          {tab === "reports" && (
            <ReportsView data={data} today={today} curKey={curKey} range={reportRange} onRange={setReportRange}
              onOpenPeriod={(key) => {
                if (key === curKey) { setTab("dashboard"); return; }
                if (data.months[key]) { setTab("history"); setHistoryKey(key); }
              }} />
          )}

          {/* SAVINGS */}
          {tab === "savings" && (
            <SavingsView data={data} history={leftOver} today={today} cal={cal}
              onAddGoal={() => setModal({ type: "goal" })}
              onEditGoal={(g) => setModal({ type: "goal", editId: g.id })}
              onChangeIncome={(key, v) => patchMonth(key, { income: v })}
              onOpenPeriod={(key) => { setTab("history"); setHistoryKey(key); }} />
          )}

          {tab === "accounts" && (
            <AccountsView accounts={accounts} todayISO={todayISO}
              onAdd={() => setModal({ type: "account" })}
              onEdit={(a) => setModal({ type: "account", editId: a.id })}
              onRecord={onRecordBalance} onRemoveBalance={onRemoveBalance} />
          )}
        </div>
        </div>
      </main>

      {/* MODALS */}
      {modal?.type === "goal" && (() => {
        const editing = modal.editId ? goals.find((g) => g.id === modal.editId) : null;
        return (
          <GoalModal goal={editing} data={data} curKey={curKey} onDismiss={() => setModal(null)}
            onSave={(v) => {
              const next = editing
                ? goals.map((g) => (g.id === editing.id ? { id: g.id, ...v } : g))
                : [...goals, { id: uid(), ...v }];
              save({ ...data, goals: next });
              setModal(null);
            }}
            onDelete={() => { save({ ...data, goals: goals.filter((g) => g.id !== editing.id) }); setModal(null); }} />
        );
      })()}
      {modal?.type === "account" && (() => {
        const editing = modal.editId ? accounts.find((a) => a.id === modal.editId) : null;
        const replace = (next) => saveAccounts(accounts.map((a) => (a.id === editing.id ? next : a)));
        return (
          <AccountModal account={editing} todayISO={todayISO} onDismiss={() => setModal(null)}
            onSave={(v) => {
              if (editing) replace({ ...editing, name: v.name, kind: v.kind });
              else saveAccounts([...accounts, recordBalance({ id: uid(), name: v.name, kind: v.kind, balances: [] }, { date: v.date, amount: v.amount })]);
              setModal(null);
            }}
            onSetClosed={(close) => { replace(close ? closeAccount(editing, todayISO) : reopenAccount(editing)); setModal(null); }}
            onDelete={() => { saveAccounts(accounts.filter((a) => a.id !== editing.id)); setModal(null); }} />
        );
      })()}
      {modal?.type === "expense" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const editing = modal.editId ? targetMonth.expenses.find((x) => x.id === modal.editId) : null;
        return (
          <ExpenseModal editing={editing} categories={data.categories} defaultDate={cal.newEntryDate(targetKey, today)}
            onClose={() => setModal(null)}
            onSave={(v) => {
              // Every category named - the one, or each part's - is created if new.
              let categories = data.categories;
              const resolve = (n) => { const r = ensureCategory(categories, n); categories = r.categories; return r.category.name; };
              const fields = { name: v.name, amount: v.amount, date: v.date, note: v.note, category: resolve(v.category) };
              if (v.splits) fields.splits = v.splits.map((p) => ({ ...p, category: resolve(p.category) }));
              const build = (base) => {
                const e = { ...base, ...fields };
                if (!v.splits) delete e.splits;
                return e;
              };
              const expenses = editing
                ? targetMonth.expenses.map((x) => (x.id === editing.id ? build(x) : x))
                : [...targetMonth.expenses, build({ id: uid() })];
              save({ ...data, categories, months: { ...data.months, [targetKey]: { ...targetMonth, expenses } } });
              setModal(null);
            }} />
        );
      })()}
      {modal?.type === "recurring" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        // Editing a PAST month is a correction to history only — it must not rewrite
        // the live template, which governs future months.
        const touchesTemplate = targetKey === curKey;
        const editing = modal.editId ? targetMonth.recurring.find((x) => x.id === modal.editId) : null;
        // A copy corrected in a past period keeps its own date when it has one:
        // a weekly copy, or any copy in a fortnight. A new one gets a day of the month.
        const dated = !touchesTemplate && !!editing && (isWeekly(editing) || cal.dated(targetKey));
        // A bill not due this period has no instance here, only its template.
        const editingTpl = modal.templateId ? (data.recurringTemplate || []).find((x) => x.id === modal.templateId) : null;
        const tplOf = editing ? (data.recurringTemplate || []).find((x) => x.id === editing.templateId) : null;
        const source = editingTpl || editing;
        const sched = editingTpl || tplOf || editing || {};
        return (
          <FormModal title={source ? t("Edit Recurring Payment") : t("Add Recurring Payment")} fields={[
            { key: "name", label: t("Name"), placeholder: t("e.g. Rent"), defaultValue: source?.name },
            { key: "amount", label: t("Amount ({currency})", { currency: currencyCode() }), type: "number", placeholder: "0", defaultValue: source ? String(source.amount) : "" },
            { key: "category", label: t("Category"), type: "category", categories: data.categories, defaultValue: source?.category },
            { key: "dayOfMonth", label: t("Day of Month"), type: "number", placeholder: "1",
              defaultValue: source?.dayOfMonth != null ? String(source.dayOfMonth) : "", when: (vals) => !weeklyChoice(vals) && !dated },
            { key: "date", label: t("Date"), type: "date", defaultValue: editing?.date || "", when: () => dated },
            // Frequency belongs to the template, so it is offered only where the
            // template is being edited - not on a correction to a past period.
            ...(touchesTemplate ? [
              { key: "repeats", label: t("Repeats"), type: "select", options: REPEAT_OPTIONS.map((o) => o.label), defaultValue: repeatLabel(sched) },
              { key: "anchor", label: t("First due in"), type: "month", defaultValue: sched.anchor || cal.cycleKey(cal.range(targetKey).start), when: (vals) => !weeklyChoice(vals) },
              { key: "startDate", label: t("First date"), type: "date", defaultValue: sched.startDate || cal.newEntryDate(curKey, today),
                when: (vals) => !!weeklyChoice(vals) },
            ] : []),
            { key: "autoPay", label: t("Pays itself"), type: "checkbox", defaultValue: source?.autoPay,
              hint: t("Direct debit or card on file. Never sends a reminder.") },
            NOTE_FIELD(source),
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const { categories, category } = ensureCategory(data.categories, v.category);
            // A dated copy keeps its date; anything else falls on a day of the month.
            const fields = { name: v.name, amount: +v.amount, ...(dated ? { date: v.date || editing?.date } : { dayOfMonth: dayOfMonthFrom(v.dayOfMonth) }),
                             category: category.name, autoPay: !!v.autoPay, note: cleanNote(v.note) };
            // A cycle counts in the budget's monthly periods: from the one this period starts in.
            const schedule = scheduleFromForm(v, sched, cal.cycleKey(cal.range(targetKey).start), cal.newEntryDate(curKey, today));
            save({ ...saveRecurring(data, "recurring", { cal, curKey, targetKey, editing, editingTpl, fields, schedule, newId: uid, today }), categories });
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "upcoming" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const editing = modal.editId ? targetMonth.upcoming.find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? t("Edit Upcoming Payment") : t("Add Upcoming Payment")} fields={[
            { key: "name", label: t("Name"), placeholder: t("e.g. Car Insurance"), defaultValue: editing?.name },
            { key: "amount", label: t("Amount ({currency})", { currency: currencyCode() }), type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: t("Category"), type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "dueDate", label: t("Due Date"), type: "date", defaultValue: editing?.dueDate || cal.newEntryDate(targetKey, today) },
            { key: "autoPay", label: t("Pays itself"), type: "checkbox", defaultValue: editing?.autoPay,
              hint: t("Direct debit or card on file. Counts as paid on its due date and never sends a reminder.") },
            NOTE_FIELD(editing),
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const { categories, category } = ensureCategory(data.categories, v.category);
            if (editing) {
              save({
                ...data,
                categories,
                months: {
                  ...data.months,
                  [targetKey]: {
                    ...targetMonth,
                    upcoming: targetMonth.upcoming.map((x) => x.id === editing.id
                      ? { ...x, name: v.name, amount: +v.amount, dueDate: v.dueDate, category: category.name, autoPay: !!v.autoPay, note: cleanNote(v.note) }
                      : x),
                  },
                },
              });
            } else {
              const newItem = { id: uid(), name: v.name, amount: +v.amount, dueDate: v.dueDate, paid: false, autoPay: !!v.autoPay, category: category.name, note: cleanNote(v.note) };
              save({
                ...data,
                categories,
                months: { ...data.months, [targetKey]: { ...targetMonth, upcoming: [...targetMonth.upcoming, newItem] } },
              });
            }
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "creditRecurring" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const touchesTemplate = targetKey === curKey;
        const editing = modal.editId ? (targetMonth.credits || []).find((x) => x.id === modal.editId) : null;
        const dated = !touchesTemplate && !!editing && (isWeekly(editing) || cal.dated(targetKey));
        const editingTpl = modal.templateId ? (data.creditTemplate || []).find((x) => x.id === modal.templateId) : null;
        const tplOf = editing ? (data.creditTemplate || []).find((x) => x.id === editing.templateId) : null;
        const source = editingTpl || editing;
        const sched = editingTpl || tplOf || editing || {};
        return (
          <FormModal title={source ? t("Edit Recurring Credit") : t("Add Recurring Credit")} fields={[
            { key: "name", label: t("Name"), placeholder: t("e.g. Allowance"), defaultValue: source?.name },
            { key: "amount", label: t("Amount ({currency})", { currency: currencyCode() }), type: "number", placeholder: "0", defaultValue: source ? String(source.amount) : "" },
            { key: "category", label: t("Source"), type: "category", categories: data.creditCategories || [], defaultValue: source?.category },
            { key: "dayOfMonth", label: t("Day of Month"), type: "number", placeholder: "1",
              defaultValue: source?.dayOfMonth != null ? String(source.dayOfMonth) : "", when: (vals) => !weeklyChoice(vals) && !dated },
            { key: "date", label: t("Date"), type: "date", defaultValue: editing?.date || "", when: () => dated },
            // Frequency belongs to the template, so it is offered only where the
            // template is being edited - not on a correction to a past period.
            ...(touchesTemplate ? [
              { key: "repeats", label: t("Repeats"), type: "select", options: REPEAT_OPTIONS.map((o) => o.label), defaultValue: repeatLabel(sched) },
              { key: "anchor", label: t("First due in"), type: "month", defaultValue: sched.anchor || cal.cycleKey(cal.range(targetKey).start), when: (vals) => !weeklyChoice(vals) },
              { key: "startDate", label: t("First date"), type: "date", defaultValue: sched.startDate || cal.newEntryDate(curKey, today),
                when: (vals) => !!weeklyChoice(vals) },
            ] : []),
            NOTE_FIELD(source),
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const amt = +v.amount;
            if (!v.name || !(amt > 0)) { setModal(null); return; }
            const { categories: creditCategories, category } = ensureCreditCategory(data.creditCategories || [], v.category);
            const fields = { name: v.name, amount: amt, ...(dated ? { date: v.date || editing?.date } : { dayOfMonth: dayOfMonthFrom(v.dayOfMonth) }),
                             category: category.name, note: cleanNote(v.note) };
            // A cycle counts in the budget's monthly periods: from the one this period starts in.
            const schedule = scheduleFromForm(v, sched, cal.cycleKey(cal.range(targetKey).start), cal.newEntryDate(curKey, today));
            save({ ...saveRecurring(data, "credits", { cal, curKey, targetKey, editing, editingTpl, fields, schedule, newId: uid, today }), creditCategories });
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "credit" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const editing = modal.editId ? (targetMonth.credits || []).find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? t("Edit Credit") : t("Add Credit")} fields={[
            { key: "name", label: t("Name"), placeholder: t("e.g. Amazon refund"), defaultValue: editing?.name },
            { key: "amount", label: t("Amount ({currency})", { currency: currencyCode() }), type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: t("Source"), type: "category", categories: data.creditCategories || [], defaultValue: editing?.category || editing?.source },
            { key: "date", label: t("Date"), type: "date", defaultValue: editing?.date || cal.newEntryDate(targetKey, today) },
            NOTE_FIELD(editing),
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const amt = +v.amount;
            if (!v.name || !(amt > 0)) { setModal(null); return; }
            const { categories: creditCategories, category } = ensureCreditCategory(data.creditCategories || [], v.category);
            const nextCredits = editing
              ? (targetMonth.credits || []).map((x) => x.id === editing.id
                  ? { ...x, name: v.name, amount: amt, date: v.date, category: category.name, note: cleanNote(v.note) }
                  : x)
              : [...(targetMonth.credits || []), { id: uid(), name: v.name, amount: amt, date: v.date, category: category.name, note: cleanNote(v.note) }];
            save({
              ...data,
              creditCategories,
              months: { ...data.months, [targetKey]: { ...targetMonth, credits: nextCredits } },
            });
            setModal(null);
          }} />
        );
      })()}

      <Toast message={toast} />

      {setupOpen && (
        <SetupWizard data={data}
          onFinish={(answers, then) => {
            save(applySetup(data, answers, today), { undoable: false });
            setSetupOpen(false);
            if (then === "statement") setStatementOpen(true);
          }}
          onRestore={() => { setSetupOpen(false); triggerImport(); }}
          onSkip={() => { save({ ...data, setupDone: true }, { undoable: false }); setSetupOpen(false); }}
          onChangeLanguage={(language) => save({ ...data, language }, { undoable: false })} />
      )}

      {searchOpen && (
        <SearchModal data={data} query={searchQuery} onQueryChange={setSearchQuery}
          onClose={() => setSearchOpen(false)}
          onOpen={(r) => {
            // Each kind opens in its own dialog, in the period it belongs to.
            const type = editFormFor({ expense: "expense", recurring: "recurring", upcoming: "upcoming", credit: "credit" }[r.kind], r.entry);
            setSearchOpen(false);
            setModal({ type, editId: r.entry.id, monthKey: r.periodKey });
          }} />
      )}

      {statementOpen && (
        <StatementImport data={data} onClose={() => setStatementOpen(false)}
          onImport={async (next, counts) => {
            // A statement can add hundreds of rows at once. Snapshot first, so a
            // wrong column guess is one restore away rather than an afternoon.
            if (isTauri) {
              try {
                const current = await window.storage.get(STORAGE_KEY);
                if (current?.value) await writeBackup(current.value, "before-statement-import");
              } catch { /* never block the import on a failed snapshot */ }
            }
            await save(next);
            setStatementOpen(false);
            const parts = [];
            if (counts.expenses) parts.push(tn(counts.expenses, "{n} expense", "{n} expenses"));
            if (counts.credits) parts.push(tn(counts.credits, "{n} credit", "{n} credits"));
            if (counts.markedPaid) parts.push(tn(counts.markedPaid, "{n} payment marked paid", "{n} payments marked paid"));
            const spotted = findRegularPayments(next, today).length;
            alert((parts.length ? t("Imported {what}.", { what: parts.join(", ") }) : t("Nothing was imported.")) +
              (counts.rules ? "\n\n" + tn(counts.rules, "{n} new import rule will file these for you next time.", "{n} new import rules will file these for you next time.") : "") +
              (spotted ? "\n\n" + tn(spotted, "{n} payment looks like a monthly bill. See the Recurring tab to make it recurring.", "{n} payments look like a monthly bill. See the Recurring tab to make them recurring.") : "") +
              (isTauri ? "\n\n" + t("A backup was taken first — restore it from Settings → Data if anything looks wrong.") : ""));
          }} />
      )}

      {pinDialog && (
        <PinDialog mode={pinDialog} lock={lockCfg} onClose={() => setPinDialog(null)}
          onDone={async (cfg) => {
            try {
              await writeLock(cfg);
              setLockCfg(cfg);
              setToast(cfg ? (pinDialog === "set" ? t("Lock is on") : t("PIN changed")) : t("Lock is off"));
            } catch (err) {
              alert(t("Couldn't save the lock: {error}", { error: String(err) }));
            }
            setPinDialog(null);
          }} />
      )}

      {rulesOpen && (
        <RulesManager data={data} onChange={(importRules) => save({ ...data, importRules })} onClose={() => setRulesOpen(false)} />
      )}

      {categoriesOpen && (
        <CategoryManager data={data} onClose={() => setCategoriesOpen(false)} onChange={(next) => save(next)} />
      )}

      {whatsNew && (
        <WhatsNewModal entries={whatsNew.entries} onClose={() => setWhatsNew(null)}
          title={whatsNew.launch ? t("What's new in Budget Ctrl {version}", { version: whatsNew.entries[0]?.version === "Unreleased" ? APP_VERSION : whatsNew.entries[0]?.version || APP_VERSION }) : t("What's new")} />
      )}
      {payDialog && (
        <PayScheduleModal data={data} today={today} initialKind={payDialog.kind} initialCutoff={payDialog.cutoffDay}
          onCancel={() => { setPayDialog(null); setSettingsOpen(true); }}
          onSwitch={onSwitchSchedule} />
      )}
      {settingsOpen && (
        <SettingsModal
          data={data}
          onClose={() => setSettingsOpen(false)}
          onChangeReminders={(reminders) => save({ ...data, reminders })}
          updater={updater}
          onChangeUpdates={(updates) => save({ ...data, updates })}
          onInstallUpdate={installUpdate}
          onChangeCutoff={onChangeCutoff}
          onChangePay={(opts) => { setSettingsOpen(false); setPayDialog(opts); }}
          onWhatsNew={() => loadChangelog().then((all) => { setSettingsOpen(false); setWhatsNew({ entries: allNotes(all, import.meta.env.DEV), launch: false }); })}
          today={today}
          onExport={() => exportData(data)}
          onExportCsv={() => exportCsv(data)}
          onImport={triggerImport}
          onImportStatement={() => { setSettingsOpen(false); setStatementOpen(true); }}
          onReset={resetAll}
          onChangeCurrency={(currency) => save({ ...data, currency })}
          onChangeLocale={(locale) => save({ ...data, locale })}
          onChangeLanguage={(language) => save({ ...data, language })}
          onManageCategories={() => { setSettingsOpen(false); setCategoriesOpen(true); }}
          onManageRules={() => { setSettingsOpen(false); setRulesOpen(true); }}
          lockCfg={lockCfg}
          onPinAction={(mode) => { setSettingsOpen(false); setPinDialog(mode); }}
          onChangeLock={(cfg) => { writeLock(cfg).then(() => setLockCfg(cfg)).catch((err) => alert(t("Couldn't save the lock: {error}", { error: String(err) }))); }}
          onRestore={async (name) => {
            if (!confirm(t("Replace all current data with the backup \"{name}\"?\n\nWhat you have now is backed up first.", { name }))) return;
            try {
              const text = await readBackup(name);
              const parsed = JSON.parse(text);
              if (!parsed || typeof parsed !== "object" || !parsed.months) {
                alert(t("That backup could not be read."));
                return;
              }
              // Snapshot the current state before replacing it, so restoring to
              // the wrong point is itself recoverable.
              try {
                const current = await window.storage.get(STORAGE_KEY);
                if (current?.value) await writeBackup(current.value, "before-restore");
              } catch { /* never block the restore */ }
              await save(hydrate(migrate(parsed)));
              setSettingsOpen(false);
            } catch {
              alert(t("That backup could not be read."));
            }
          }}
        />
      )}
    </div>
    </DeleteArmContext.Provider>
    </ThemeContext.Provider>
  );
}
