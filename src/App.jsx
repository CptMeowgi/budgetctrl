import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { closeAccount, recordBalance, removeBalance, reopenAccount } from "./lib/accounts.js";
import { envelope, startFresh, withCap, withRollover } from "./lib/envelopes.js";
import { currentPeriodKey, isoDay, periodLabel } from "./lib/periods.js";
import { collectDueBills, OVERDUE_GRACE_DAYS, upcomingSettled, whenLabel } from "./lib/reminders.js";
import { periodNoun } from "./lib/reports.js";
import { everyFromLabel, FREQUENCIES, frequencyLabel, isOnCycle } from "./lib/schedule.js";
import { categoryAverage, creditReceived, periodIncome, periodSpending } from "./lib/totals.js";
import { AccountModal, AccountsView } from "./components/AccountsView.jsx";
import { CategoryBudgets } from "./components/CategoryBudgets.jsx";
import { CategoryManager } from "./components/CategoryManager.jsx";
import { CategoryDonut, SavingsChart } from "./components/charts.jsx";
import { CategoryPill, GoalProgress, InfoHint, InlineNumber, StatCard, TableHeader, Toast } from "./components/controls.jsx";
import { FormModal } from "./components/FormModal.jsx";
import { ReportsView } from "./components/ReportsView.jsx";
import { EntryName, ExpenseRow, MissingFromTemplate, NotDueThisPeriod, RecurringRow, RowActions, UpcomingRow } from "./components/rows.jsx";
import { SettingsModal } from "./components/SettingsModal.jsx";
import { StatementImport } from "./components/StatementImport.jsx";
import { UpdateBanner } from "./components/UpdateBanner.jsx";
import { WindowControls } from "./components/WindowControls.jsx";
import { DeleteArmContext } from "./contexts.js";
import { exportCsv, exportData } from "./exportFiles.js";
import { cleanNote, NOTE_FIELD } from "./forms.js";
import { useReminders } from "./hooks/useReminders.js";
import { useUpdater } from "./hooks/useUpdater.js";
import { ENTRY_COLUMNS, filterAndSort, toggleSort } from "./listView.js";
import { categoryBreakdown, countRebucketMoves, CREDIT_UNCATEGORIZED, cumulativeSavings, defaultData, emptyMonth, ensureCategory, ensureCreditCategory, ensureCurrentMonth, hydrate, migrate, rebucketData, STORAGE_KEY, uid } from "./model.js";
import { currencyCode, fmt, setMoneyFormat } from "./money.js";
import { isTauri } from "./platform.js";
import { readBackup, writeBackup } from "./storage.js";
import { CHIP_GRAY, DARK_THEME, FOCUS_BLUE, FONT, LIGHT_THEME, makeStyles, RADIUS, SPACE, ThemeContext, TYPE } from "./theme.js";

const UNDO_LIMIT = 50;

// Which tabs offer an "+ Add" CTA, what it is called, and which modal it opens.
// Previously three parallel inline ternaries in the header that had to be kept
// in sync by hand.
const ADD_LABELS = {
  expenses: "Expense",
  recurring: "Recurring",
  upcoming: "Payment",
  accounts: "Account",
};
const MODAL_FOR_TAB = { expenses: "expense", accounts: "account" };

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "◉" },
  { id: "expenses", label: "Expenses", icon: "↗" },
  { id: "recurring", label: "Recurring", icon: "↻" },
  { id: "upcoming", label: "Upcoming", icon: "◈" },
  { id: "credits", label: "Credits", icon: "+" },
  { id: "history", label: "History", icon: "◷" },
  { id: "reports", label: "Reports", icon: "▦" },
  { id: "savings", label: "Savings", icon: "◆" },
  { id: "accounts", label: "Accounts", icon: "¤" },
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
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [historyKey, setHistoryKey] = useState(null);
  const [reportRange, setReportRange] = useState(null);
  const importInputRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem("themeMode") || "light"; } catch { return "light"; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  // Bumped by the reminder tick when the calendar date rolls over; `today`
  // below is keyed to it so a long-lived tray session doesn't show a stale date.
  const [todayKey, setTodayKey] = useState(() => isoDay(new Date()));
  const [expensesView, setExpensesView] = useState({ search: "", sorts: [] });
  const [recurringView, setRecurringView] = useState({ search: "", sorts: [] });
  const [upcomingView, setUpcomingView] = useState({ search: "", sorts: [] });
  const [creditsView, setCreditsView] = useState({ search: "", sorts: [] });
  const triggerImport = () => importInputRef.current?.click();
  const resetAll = async () => {
    if (!confirm("Delete your whole budget and start again?\n\nWhat you have now is backed up first, and Ctrl+Z undoes it.")) return;
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
          alert("Could not read backup file. Make sure it's a valid budget-ctrl JSON export.");
          return;
        }
        if (!confirm("Replace all your current data with this backup?\n\nWhat you have now is backed up first, and Ctrl+Z undoes it.")) return;
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
        alert("Could not read backup file. Make sure it's a valid budget-ctrl JSON export.");
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
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(next)); } catch { /* in-memory state still updated; surfaced on next load */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(STORAGE_KEY);
        if (r?.value) {
          const raw = JSON.parse(r.value);
          const migrated = hydrate(migrate(raw));
          setData(migrated);
          if (migrated !== raw) {
            try { await window.storage.set(STORAGE_KEY, JSON.stringify(migrated)); } catch { /* migration re-runs next load if this fails */ }
          }
        } else {
          // Persist immediately rather than holding defaults in memory, so the
          // data file exists from first launch instead of first edit.
          await save(hydrate(defaultData()), { undoable: false });
        }
      } catch { /* Tauri API unavailable (browser dev server) */ }
      setLoaded(true);
    })();
    // `save` has no deps of its own, so this still runs exactly once.
  }, [save]);

  useEffect(() => {
    if (!pendingDelete) return;
    const t = setTimeout(() => setPendingDelete(null), 3000);
    return () => clearTimeout(t);
  }, [pendingDelete]);

  useEffect(() => {
    try { localStorage.setItem("themeMode", themeMode); } catch { /* theme falls back to light next launch */ }
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
    const closed = key < currentPeriodKey(data.cutoffDay || 1);
    save({
      ...data,
      months: {
        ...data.months,
        [key]: { ...m, ...patch, ...(closed ? { editedAt: new Date().toISOString() } : {}) },
      },
    });
  }, [data, save]);

  const patchCur = useCallback((patch) => {
    patchMonth(currentPeriodKey(data.cutoffDay || 1), patch);
  }, [patchMonth, data.cutoffDay]);

  // Applied during render so every fmt() below this line uses the chosen
  // currency, including the ones inside helpers called from the JSX.
  setMoneyFormat(data.currency, data.locale || navigator.language || "en-US");

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
    if (!h[from].length) { setToast(`Nothing to ${label.toLowerCase()}`); return; }
    const target = h[from].pop();
    h[to].push(dataRef.current);
    h.lastPushAt = 0; // the next edit starts a fresh undo step
    setHistorySize({ past: h.past.length, future: h.future.length });
    setData(target);
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(target)); } catch { /* in-memory state still updated */ }
    setToast(label === "Undo" ? "Undone" : "Redone");
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
      const dialogOpen = !!modal || settingsOpen || categoriesOpen || statementOpen;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (dialogOpen) return;
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
        const search = document.querySelector('main input[placeholder^="Search"]');
        if (search) { e.preventDefault(); search.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, settingsOpen, categoriesOpen, statementOpen, tab, undo, redo]);

  // Derived from todayKey rather than recomputed per render: stable within a
  // day, and guaranteed to refresh when the tick above crosses midnight. Local
  // midnight is also the right value for the day-granularity comparisons in
  // isRecurringDue, which treat period bounds as whole days.
  const today = useMemo(() => new Date(`${todayKey}T00:00:00`), [todayKey]);

  if (!loaded) return <div style={s.shell}><div style={{ color: "#6b7280", textAlign: "center", marginTop: 200, fontSize: 14 }}>Loading...</div></div>;

  const cutoffDay = data.cutoffDay || 1;
  const curKey = currentPeriodKey(cutoffDay);
  const cur = data.months[curKey] || emptyMonth();

  // Every spending and income figure on screen comes from these two. Nothing
  // below re-sums entries, or the cards and charts drift apart again.
  const spending = periodSpending(cur, curKey, today, cutoffDay);
  const income = periodIncome(cur, curKey, today, cutoffDay);
  const totalExpenses = spending.expenses;
  const totalRecurringAll = cur.recurring.reduce((a, e) => a + e.amount, 0);
  const totalRecurringFuture = totalRecurringAll - spending.recurring;
  const totalUnpaidUpcoming = cur.upcoming.filter((u) => !upcomingSettled(u, today)).reduce((a, e) => a + e.amount, 0);
  const isReceived = (c) => creditReceived(c, curKey, today, cutoffDay);
  const totalCredits = income.credits;
  const totalCreditsPending = income.pending;
  const effectiveIncome = income.total;
  const totalActuallySpent = spending.total;
  const totalStillScheduled = totalRecurringFuture + totalUnpaidUpcoming;
  const totalCommitted = totalActuallySpent;
  const availableAfterCommitted = Math.max(0, effectiveIncome - totalCommitted);
  const savingsGoal = data.savingsGoal || { monthly: 0, target: 0 };
  // Store what was typed, apply what the period can actually cover - the same
  // split the percentage version used, so a lean month cannot silently rewrite
  // the goal. The gap is surfaced rather than hidden.
  const savingsTarget = Math.min(savingsGoal.monthly, availableAfterCommitted);
  const savingsShortfall = Math.max(0, savingsGoal.monthly - availableAfterCommitted);
  const leftToSpend = Math.max(0, availableAfterCommitted - savingsTarget);
  const remaining = effectiveIncome - totalCommitted;
  const unpaidCount = cur.upcoming.filter((u) => !upcomingSettled(u, today)).length;
  // Only bills due THIS period can be missing from it. Without the cycle check a
  // yearly bill would be reported missing in the eleven periods it is not due.
  const missingRecurring = (data.recurringTemplate || []).filter(
    (tpl) => isOnCycle(tpl, curKey) && !cur.recurring.some((r) => r.templateId === tpl.id));
  const missingCredits = (data.creditTemplate || []).filter(
    (tpl) => isOnCycle(tpl, curKey) && !(cur.credits || []).some((c) => c.templateId === tpl.id));
  const offCycleRecurring = (data.recurringTemplate || []).filter((tpl) => !isOnCycle(tpl, curKey));
  const offCycleCredits = (data.creditTemplate || []).filter((tpl) => !isOnCycle(tpl, curKey));
  const reminderLeadDays = Number.isFinite(data.reminders?.leadDays) ? data.reminders.leadDays : 3;
  // Exactly what a reminder would fire for, so the notification and the screen
  // can never disagree about what is due.
  const dueBills = collectDueBills(data, today, reminderLeadDays, Infinity);
  const totalUpcoming = totalUnpaidUpcoming;

  const catBreakdown = categoryBreakdown(spending.byCategory, data.categories || []);
  const catTotal = spending.total;
  const savings = cumulativeSavings(data, today);
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
    if (clamped === cutoffDay) return;
    const moves = countRebucketMoves(data, clamped);
    if (moves === 0) { save({ ...data, cutoffDay: clamped }); return; }
    const ok = confirm(
      `Re-bucket ${moves} ${moves === 1 ? "entry" : "entries"} to match the new cutoff?\n\n` +
      `Expenses, one-off credits and upcoming payments will move to the period their date falls in. ` +
      `Recurring items and income stay where they are.\n\n` +
      `Choose Cancel to change the cutoff without moving anything.`
    );
    save(ok ? { ...rebucketData(data, clamped), cutoffDay: clamped } : { ...data, cutoffDay: clamped });
  };

  // Budget and rollover change together, as one undo step. A budget change
  // applies from this period on; earlier periods keep the budget they had.
  const onSetBudget = (name, newCap, rollover) => {
    save({
      ...data,
      categories: data.categories.map((c) => {
        if (c.name !== name) return c;
        const capped = (c.cap ?? null) === newCap ? c : withCap(c, newCap, curKey);
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
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,300;0,400;0,600;0,700&display=swap" rel="stylesheet" />
      <style>{`
        *[data-tauri-drag-region] { app-region: drag; -webkit-app-region: drag; }
        *[data-tauri-drag-region] button,
        *[data-tauri-drag-region] input,
        *[data-tauri-drag-region] select,
        *[data-tauri-drag-region] a { app-region: no-drag; -webkit-app-region: no-drag; }

        /* Scrollbars follow the theme. color-scheme also darkens the number-input
           spinners and any other native control the panels render. */
        :root { color-scheme: ${themeMode === "dark" ? "dark" : "light"}; }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${theme.border}; border-radius: 5px; }
        ::-webkit-scrollbar-thumb:hover { background: ${theme.textFaint}; }
        ::-webkit-scrollbar-corner { background: transparent; }

        /* Interaction states. Active compresses to 0.95, focus is a 2px ring in
           Focus Blue; both are spec'd for every button. */
        button, input, select, textarea { font-family: inherit; }
        button { transition: transform .12s ease, background-color .2s ease, color .2s ease, opacity .2s ease; }
        button:active:not(:disabled) { transform: scale(0.95); }
        :focus-visible { outline: 2px solid ${FOCUS_BLUE}; outline-offset: 2px; }
        .icon-btn:hover { background: ${CHIP_GRAY} !important; }

        /* Inline-editable cells read as text until you reach for them. */
        .inline-edit { border: 1px solid transparent; transition: border-color .15s ease, background-color .15s ease; }
        .inline-edit:hover { border-color: ${theme.border}; }
        .inline-edit:focus { border-color: ${FOCUS_BLUE}; background: ${theme.bg} !important; }
      `}</style>

      {/* SIDEBAR */}
      <aside style={s.sidebar}>
        <div data-tauri-drag-region style={s.logo}>
          <div data-tauri-drag-region style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5, color: theme.outerText }}>BUDGET</div>
          <div data-tauri-drag-region style={{ fontSize: 10, letterSpacing: 3, color: theme.accent, fontWeight: 700 }}>CTRL</div>
        </div>
        <nav style={s.nav}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); if (t.id !== "history") setHistoryKey(null); }}
              style={tab === t.id ? { ...s.navItem, ...s.navItemActive } : s.navItem}>
              <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{t.icon}</span>
              <span>{t.label}</span>
              {t.id === "upcoming" && dueBills.length > 0 && <span style={s.badge} title="Due soon or overdue">{dueBills.length}</span>}
            </button>
          ))}
        </nav>
        <input type="file" accept=".json" ref={importInputRef} onChange={onImportFile} style={{ display: "none" }} />
      </aside>

      {/* MAIN */}
      <main style={s.main}>
        <header data-tauri-drag-region style={{ ...s.topbar, position: "relative", paddingTop: isTauri ? 44 : SPACE.lg, paddingRight: SPACE.md }}>
          <WindowControls />
          {/* The whole bar drags; interactive children opt out via app-region: no-drag */}
          <div data-tauri-drag-region style={{ flex: 1, alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <h1 data-tauri-drag-region style={{ ...TYPE.tagline, margin: 0, color: theme.outerText }}>
              {TABS.find((t) => t.id === tab)?.label}
            </h1>
            <div data-tauri-drag-region style={{ ...TYPE.navLink, color: theme.outerTextMuted, marginTop: 6 }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              {cutoffDay > 1 && (
                <span style={{ color: theme.outerTextMuted }}> · period {periodLabel(curKey, cutoffDay).range}</span>
              )}
            </div>
          </div>
          {/* One right-hand group in normal flow: the Add CTA plus the two icon
              controls, sharing a baseline and ending flush at the edge. */}
          <div style={{ display: "flex", alignItems: "center", gap: SPACE.xs, flexShrink: 0 }}>
            {ADD_LABELS[tab] && (
              <button style={s.addBtn} onClick={() => setModal({ type: MODAL_FOR_TAB[tab] || tab })}>
                + Add {ADD_LABELS[tab]}
              </button>
            )}
            <button
              className="icon-btn"
              style={{ ...s.themeToggle, opacity: historySize.past ? 1 : 0.35, cursor: historySize.past ? "pointer" : "default" }}
              disabled={!historySize.past}
              onClick={undo}
              title="Undo (Ctrl+Z)"
            >↶</button>
            <button
              className="icon-btn"
              style={s.themeToggle}
              onClick={() => setThemeMode((m) => m === "dark" ? "light" : "dark")}
              title={themeMode === "dark" ? "Switch to light panel" : "Switch to dark panel"}
            >
              {themeMode === "dark" ? "☀" : "☾"}
            </button>
            <button className="icon-btn" style={s.themeToggle} onClick={() => setSettingsOpen(true)} title="Settings">⚙</button>
          </div>
        </header>

        <div style={s.content}>
          <div style={s.contentInner}>
          <UpdateBanner updater={updater} onInstall={installUpdate} />
          {/* DASHBOARD */}
          {tab === "dashboard" && (
            <>
              {/* Column count is left to statsRow's auto-fit. Pinning it to
                  repeat(5, 1fr) overflowed the row, because a bare 1fr is
                  minmax(auto, 1fr) and the largest currency value refused to
                  shrink below its own content width. */}
              <div style={s.statsRow}>
                <StatCard label="Remaining" value={fmt(remaining)} accent={remaining >= 0 ? "#10b981" : "#ef4444"} sub={totalStillScheduled > 0 ? `${fmt(totalStillScheduled)} still scheduled` : "Everything's landed"} icon="↓" />
                <StatCard label="Still to Pay" value={fmt(totalUpcoming)} accent="#f59e0b" sub={`${unpaidCount} upcoming payment${unpaidCount !== 1 ? "s" : ""}`} icon="◈" />
                <StatCard label="Total Spent" value={fmt(totalActuallySpent)} accent="#ef4444" sub={`${cur.expenses.length} one-off · ${cur.recurring.length} recurring`} icon="↻" />
                {savings.monthsCounted > 0 && (
                  <StatCard label="Saved So Far" value={fmt(savings.total)}
                    accent={savings.total >= 0 ? "#10b981" : "#ef4444"}
                    sub={`Across ${savings.monthsCounted} closed month${savings.monthsCounted !== 1 ? "s" : ""}`} icon="◆" />
                )}
              </div>
              {dueBills.length > 0 && (
                <div style={{ ...s.card, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Due soon</div>
                    <button style={s.linkBtn} onClick={() => setTab("upcoming")}>View all →</button>
                  </div>
                  {dueBills.slice(0, 5).map((b) => (
                    <div key={b.id} style={s.miniRow}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</div>
                        <div style={{ fontSize: 11, color: b.inDays < 0 ? theme.danger : theme.textMuted }}>
                          {whenLabel(b.inDays)} · {b.kind === "recurring" ? "recurring bill" : "payment"}
                        </div>
                      </div>
                      <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.warning, fontSize: 13 }}>{fmt(b.amount)}</div>
                    </div>
                  ))}
                  {dueBills.length > 5 && (
                    <div style={{ ...TYPE.finePrint, color: theme.textFaint, marginTop: SPACE.xs }}>+{dueBills.length - 5} more</div>
                  )}
                </div>
              )}

              {/* This period's income, what to set aside, and where it is going */}
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 0.95fr) minmax(0, 1.5fr)", gap: 28, alignItems: "start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={s.cardTitle}>Income this {periodNoun(cutoffDay, 1)}</div>
                      <InfoHint text="Your pay for this period. A new period starts with the last one's figure, so change it here when your pay changes. Credits are added on top." />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                      <input type="number" min={0} value={cur.income || ""} placeholder="0" aria-label="Income this period"
                        onChange={(e) => patchCur({ income: Math.max(0, +e.target.value || 0) })}
                        style={{ ...s.input, width: 130, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 18, color: theme.success }} />
                      <span style={{ ...TYPE.caption, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
                    </div>
                    {(totalCredits > 0 || totalCreditsPending > 0) && (
                      <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.success, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>
                        + {fmt(totalCredits)} credits
                        {totalCreditsPending > 0 && <span style={{ color: theme.textFaint }}> · {fmt(totalCreditsPending)} pending</span>}
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={s.cardTitle}>Set aside each {periodNoun(cutoffDay, 1)}</div>
                      <InfoHint text="How much you mean to save out of this period's money. It is taken off before Left to Spend, so what remains is genuinely free." />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                      <input type="number" min={0} value={savingsGoal.monthly || ""} placeholder="0"
                        onChange={(e) => save({ ...data, savingsGoal: { ...savingsGoal, monthly: Math.max(0, Math.floor(+e.target.value) || 0) } })}
                        style={{ ...s.input, width: 140, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 18 }} />
                      <span style={{ ...TYPE.caption, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
                    </div>
                    {savingsShortfall > 0 ? (
                      <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.warning, marginTop: 8 }}>
                        {fmt(savingsShortfall)} short this period · setting aside {fmt(savingsTarget)}
                      </div>
                    ) : savingsGoal.monthly > 0 ? (
                      <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: 8 }}>
                        Covered · {fmt(leftToSpend)} still free
                      </div>
                    ) : null}
                    {savingsGoal.target > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginBottom: 6 }}>
                          {fmt(Math.max(0, savings.total))} of {fmt(savingsGoal.target)} saved
                        </div>
                        <GoalProgress saved={savings.total} target={savingsGoal.target} />
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={s.cardTitle}>Income Breakdown</div>
                    {effectiveIncome > 0 ? (
                      <>
                        <div style={s.breakdownBar}>
                          {[
                            { pct: (totalActuallySpent / effectiveIncome) * 100, color: "#ef4444" },
                            { pct: (totalStillScheduled / effectiveIncome) * 100, color: "#f59e0b" },
                            { pct: (savingsTarget / effectiveIncome) * 100, color: "#0066cc" },
                            { pct: (leftToSpend / effectiveIncome) * 100, color: "#10b981" },
                          ].filter((x) => x.pct > 0 && isFinite(x.pct)).map((seg, i) => (
                            <div key={i} style={{ height: "100%", background: seg.color, width: `${Math.min(seg.pct, 100)}%`, transition: "width .3s" }} />
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 20, marginTop: 10, flexWrap: "wrap" }}>
                          {[
                            { color: "#ef4444", label: "Spent", val: totalActuallySpent },
                            { color: "#f59e0b", label: "Upcoming", val: totalStillScheduled },
                            { color: "#0066cc", label: "Savings", val: savingsTarget },
                            { color: "#10b981", label: "Left to spend", val: leftToSpend },
                          ].map((l) => (
                            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                              <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
                              <span style={{ color: theme.textFaint }}>{l.label}</span>
                              <span style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 600, color: theme.text }}>{fmt(l.val)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div style={s.emptySmall}>Set income to see breakdown</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Charts row 1: daily line + category donut */}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 16, marginBottom: 16 }}>
                <div style={s.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Category Budgets</div>
                    <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setCategoriesOpen(true)}>Manage</button>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <CategoryBudgets
                      categories={data.categories}
                      spent={spentByCat}
                      average={(name) => categoryAverage(data, name, curKey, today)}
                      envelopeOf={(c, sp) => envelope(data, c, curKey, today, sp)}
                      onSetBudget={onSetBudget}
                      onStartFresh={onStartFresh}
                    />
                  </div>
                </div>
                <div style={s.card}>
                  <div style={s.cardTitle}>By Category</div>
                  <CategoryDonut data={catBreakdown} total={catTotal} />
                </div>
              </div>

            </>
          )}

          {/* EXPENSES */}
          {/* Due soon and overdue, above the period's payments: what a reminder
              would fire for, recurring bills included, from any period. */}
          {tab === "upcoming" && dueBills.length > 0 && (
            <div style={{ ...s.card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>Due soon and overdue</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: theme.warning, fontSize: 16 }}>
                  {fmt(dueBills.reduce((a, b) => a + b.amount, 0))}
                </div>
              </div>
              <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginBottom: 4 }}>
                Everything a reminder would fire for: due within {reminderLeadDays} day{reminderLeadDays !== 1 ? "s" : ""},
                plus anything still unpaid past its date. Entries marked <em>pays itself</em> are excluded.
                {" "}<button style={{ ...s.linkBtn, padding: 0, ...TYPE.finePrint, fontWeight: 600 }} onClick={() => setSettingsOpen(true)}>Change the window</button>
              </div>
              {(
                <>
                  <TableHeader columns={[
                    { label: "NAME", flex: 2 }, { label: "TYPE", flex: 0.9 },
                    { label: "DUE", flex: 1 }, { label: "WHEN", flex: 1 },
                    { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 1.1, align: "right" },
                  ]} />
                  {dueBills.map((b) => (
                    <div key={b.id} style={s.tableRow}>
                      <div style={{ flex: 2, fontWeight: 600 }}>{b.name}</div>
                      <div style={{ flex: 0.9, color: theme.textMuted, ...TYPE.finePrint, lineHeight: 1.5 }}>
                        {b.kind === "recurring" ? "Recurring" : "Upcoming"}
                        {/* Reminders scan every period, but the Upcoming tab only
                            shows the current one - so an item left unpaid in an
                            earlier period was invisible while still nagging.
                            Naming its period makes that obvious. */}
                        {b.periodKey !== curKey && (
                          <span style={{ display: "block", color: theme.danger }}>
                            from {periodLabel(b.periodKey, cutoffDay).primary}
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, color: theme.textMuted, ...TYPE.caption }}>{b.dueISO}</div>
                      <div style={{ flex: 1, ...TYPE.caption, color: b.inDays < 0 ? theme.danger : b.inDays === 0 ? theme.warning : theme.textMuted }}>
                        {whenLabel(b.inDays)}
                        {b.inDays < -OVERDUE_GRACE_DAYS && (
                          <span title={`Older than ${OVERDUE_GRACE_DAYS} days, so reminders no longer mention it`}
                                style={{ display: "block", ...TYPE.microLegal, color: theme.textFaint }}>
                            not in reminders
                          </span>
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
                            }}>Mark paid</button>
                        )}
                        <button style={{ ...s.linkBtn, padding: 0 }}
                          onClick={() => setModal({ type: b.kind === "recurring" ? "recurring" : "upcoming", editId: b.entryId, monthKey: b.periodKey })}>
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                  <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: SPACE.md }}>
                    Something here that pays itself? Open it and tick <em>Pays itself</em> — it will settle on its own date and stop reminding.
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "expenses" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
                  <div style={s.cardTitle}>All Expenses</div>
                  <button style={{ ...s.linkBtn, padding: 0 }} onClick={() => setStatementOpen(true)}>Import from bank</button>
                </div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444", fontSize: 16 }}>Total: {fmt(totalExpenses)}</div>
              </div>
              <input
                type="text"
                placeholder="Search expenses..."
                value={expensesView.search}
                onChange={(e) => setExpensesView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredExpenses.length === 0 ? <div style={s.empty}>{expensesView.search ? `No expenses match "${expensesView.search}".` : `No expenses yet. Click "+ Add Expense" to start tracking.`}</div> : (
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
          {tab === "recurring" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>Recurring Payments</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#0066cc", fontSize: 16 }}>This period: {fmt(totalRecurringAll)}</div>
              </div>
              <MissingFromTemplate
                missing={missingRecurring}
                noun="recurring payment"
                onAdd={() => patchCur({ recurring: [...cur.recurring, ...missingRecurring.map((tpl) => ({ ...tpl, id: uid(), templateId: tpl.id }))] })}
              />
              <input
                type="text"
                placeholder="Search recurring..."
                value={recurringView.search}
                onChange={(e) => setRecurringView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredRecurring.length === 0 ? <div style={s.empty}>{recurringView.search ? `No recurring items match "${recurringView.search}".` : offCycleRecurring.length ? "Nothing recurring is due this period." : `No recurring payments set up. Click "+ Add Recurring" to create one.`}</div> : (
                <>
                  <TableHeader columns={ENTRY_COLUMNS.recurring} sorts={recurringView.sorts} onSort={onSortRecurring} />
                  {filteredRecurring.map((r) => (
                    <RecurringRow key={r.id} entry={r} categories={data.categories}
                      onEdit={() => setModal({ type: "recurring", editId: r.id })}
                      onDelete={() => save({
                        ...data,
                        months: { ...data.months, [curKey]: { ...cur, recurring: cur.recurring.filter((x) => x.id !== r.id) } },
                        recurringTemplate: data.recurringTemplate.filter((x) => x.id !== r.templateId),
                      })} />
                  ))}
                </>
              )}
              <NotDueThisPeriod items={offCycleRecurring} curKey={curKey} cutoffDay={cutoffDay} categories={data.categories}
                onEdit={(tpl) => setModal({ type: "recurring", templateId: tpl.id })}
                onDelete={(tpl) => save({ ...data, recurringTemplate: data.recurringTemplate.filter((x) => x.id !== tpl.id) })} />
            </div>
          )}

          {/* UPCOMING */}
          {tab === "upcoming" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>Upcoming Payments</div>
                <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#f59e0b", fontSize: 16 }}>Owed: {fmt(totalUpcoming)}</div>
              </div>
              <input
                type="text"
                placeholder="Search upcoming..."
                value={upcomingView.search}
                onChange={(e) => setUpcomingView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredUpcoming.length === 0 ? <div style={s.empty}>{upcomingView.search ? `No upcoming items match "${upcomingView.search}".` : `No upcoming payments. Click "+ Add Payment" to schedule one.`}</div> : (
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
            const recurringCredits = filteredCredits.filter((c) => c.dayOfMonth != null);
            const oneOffCredits = filteredCredits.filter((c) => c.dayOfMonth == null);
            const creditRow = (c, kind) => (
              <div key={c.id} style={s.tableRow}>
                <EntryName name={c.name} note={c.note} every={c.every} />
                <div style={{ flex: 1.2 }}><CategoryPill categoryName={c.category || c.source} categories={data.creditCategories || []} fallback={CREDIT_UNCATEGORIZED} /></div>
                {kind === "recurring"
                  ? <div style={{ flex: 1, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>{c.dayOfMonth || "—"}</div>
                  : <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{c.date}</div>}
                <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: isReceived(c) ? "#10b981" : theme.textMuted }}>+{fmt(c.amount)}</div>
                <RowActions
                  id={c.id}
                  onEdit={() => setModal({ type: kind === "recurring" ? "creditRecurring" : "credit", editId: c.id })}
                  onDelete={() => {
                    if (kind === "recurring") {
                      save({
                        ...data,
                        months: { ...data.months, [curKey]: { ...cur, credits: (cur.credits || []).filter((x) => x.id !== c.id) } },
                        creditTemplate: (data.creditTemplate || []).filter((t) => t.id !== c.templateId),
                      });
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
                    <div style={s.cardTitle}>Credits</div>
                    <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#10b981", fontSize: 16 }}>
                      Received: {fmt(totalCredits)}
                      {totalCreditsPending > 0 && <span style={{ color: theme.textMuted, fontSize: 13 }}> · {fmt(totalCreditsPending)} pending</span>}
                    </div>
                  </div>
                  <MissingFromTemplate
                    missing={missingCredits}
                    noun="recurring credit"
                    onAdd={() => patchCur({ credits: [...(cur.credits || []), ...missingCredits.map((tpl) => ({ ...tpl, id: uid(), templateId: tpl.id }))] })}
                  />
                  <input
                    type="text"
                    placeholder="Search credits..."
                    value={creditsView.search}
                    onChange={(e) => setCreditsView((v) => ({ ...v, search: e.target.value }))}
                    style={s.searchInput}
                  />
                </div>

                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Recurring Credits</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "creditRecurring" })}>+ Add Recurring</button>
                  </div>
                  {recurringCredits.length === 0 ? (
                    <div style={s.emptySmall}>{creditsView.search ? "No recurring credits match your search." : "No recurring credits. Add an allowance, stipend, or retainer."}</div>
                  ) : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2, sortKey: "name" }, { label: "SOURCE", flex: 1.2, sortKey: "category" }, { label: "DAY", flex: 1, align: "center", sortKey: "dayOfMonth" }, { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" }, { label: "", flex: 0.6, align: "center" }]} sorts={creditsView.sorts} onSort={onSortCredits} />
                      {recurringCredits.map((c) => creditRow(c, "recurring"))}
                    </>
                  )}
                  <NotDueThisPeriod items={offCycleCredits} curKey={curKey} cutoffDay={cutoffDay}
                    categories={data.creditCategories || []} fallback={CREDIT_UNCATEGORIZED} positive
                    onEdit={(tpl) => setModal({ type: "creditRecurring", templateId: tpl.id })}
                    onDelete={(tpl) => save({ ...data, creditTemplate: (data.creditTemplate || []).filter((x) => x.id !== tpl.id) })} />
                </div>

                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>One-off Credits</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "credit" })}>+ Add Credit</button>
                  </div>
                  {oneOffCredits.length === 0 ? (
                    <div style={s.emptySmall}>{creditsView.search ? "No one-off credits match your search." : "No one-off credits this month. Log a refund, gift, or bonus."}</div>
                  ) : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2, sortKey: "name" }, { label: "SOURCE", flex: 1.2, sortKey: "category" }, { label: "DATE", flex: 1, sortKey: "date" }, { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" }, { label: "", flex: 0.6, align: "center" }]} sorts={creditsView.sorts} onSort={onSortCredits} />
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
                <div style={s.cardTitle}>Past Months</div>
              </div>
              {(() => {
                const pastKeys = Object.keys(data.months).filter((k) => k !== curKey).sort().reverse();
                if (pastKeys.length === 0) {
                  return <div style={s.empty}>No past months yet. Come back after the month ends.</div>;
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                    {pastKeys.map((k) => {
                      const m = data.months[k];
                      const inc = periodIncome(m, k, today, cutoffDay);
                      const credits = inc.credits;
                      const spent = periodSpending(m, k, today, cutoffDay).total;
                      const rem = inc.total - spent;
                      const color = rem >= 0 ? "#10b981" : "#ef4444";
                      return (
                        <button key={k} onClick={() => setHistoryKey(k)} style={{
                          background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20,
                          textAlign: "left", cursor: "pointer", display: "grid",
                          gridTemplateColumns: "1.5fr 1fr 1fr 1fr 8px", gap: 16, alignItems: "center",
                          color: theme.text, fontFamily: FONT,
                        }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 16 }}>{periodLabel(k, cutoffDay).primary}</div>
                            {periodLabel(k, cutoffDay).range && (
                              <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>{periodLabel(k, cutoffDay).range}</div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Income</div>
                            <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(m.income)}</div>
                            {credits > 0 && (
                              <div style={{ fontSize: 10, color: "#10b981", fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}>+{fmt(credits)}</div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Spent</div>
                            <div style={{ fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444" }}>{fmt(spent)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Remaining</div>
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
            const spent = periodSpending(m, historyKey, today, cutoffDay).total;
            const inc = periodIncome(m, historyKey, today, cutoffDay);
            const credits = inc.credits;
            const effective = inc.total;
            const rem = effective - spent;
            return (
              <>
                <button style={{ ...s.linkBtn, marginBottom: 16, fontSize: 14 }} onClick={() => setHistoryKey(null)}>← Back to History</button>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>{periodLabel(historyKey, cutoffDay).primary}</h2>
                {periodLabel(historyKey, cutoffDay).range && (
                  <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 12 }}>{periodLabel(historyKey, cutoffDay).range}</div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: theme.textMuted, fontWeight: 600 }}>Income</span>
                  <input type="number" value={m.income || ""}
                    onChange={(ev) => patchMonth(historyKey, { income: +ev.target.value || 0 })}
                    placeholder="0" style={{ ...s.input, width: 140 }} />
                  <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
                </div>
                <div style={s.statsRow}>
                  <StatCard label="Income" value={fmt(effective)} accent="#10b981" sub={credits > 0 ? `+${fmt(credits)} credits` : "For this month"} icon="↑" />
                  <StatCard label="Remaining" value={fmt(rem)} accent={rem >= 0 ? "#10b981" : "#ef4444"} sub="After everything paid" icon="↓" />
                  <StatCard label="Total Spent" value={fmt(spent)} accent="#ef4444" sub={`${m.expenses.length} one-off · ${m.recurring.length} recurring`} icon="↻" />
                </div>
                <div style={s.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Expenses</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "expense", monthKey: historyKey })}>+ Add</button>
                  </div>
                  {m.expenses.length === 0 ? <div style={s.emptySmall}>No expenses</div> : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "CATEGORY", flex: 1.2 }, { label: "DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 0.6, align: "center" }]} />
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
                    <div style={s.cardTitle}>Recurring</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "recurring", monthKey: historyKey })}>+ Add</button>
                  </div>
                  {m.recurring.length === 0 ? <div style={s.emptySmall}>No recurring</div> : (
                    <>
                      <TableHeader columns={ENTRY_COLUMNS.recurring} />
                      {m.recurring.map((r) => (
                        <RecurringRow key={r.id} entry={r} categories={data.categories}
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
                    <div style={s.cardTitle}>Upcoming</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "upcoming", monthKey: historyKey })}>+ Add</button>
                  </div>
                  {m.upcoming.length === 0 ? <div style={s.emptySmall}>No upcoming</div> : (
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
                    <div style={s.cardTitle}>Credits</div>
                    <button style={s.linkBtn} onClick={() => setModal({ type: "credit", monthKey: historyKey })}>+ Add</button>
                  </div>
                  {(m.credits || []).length === 0 ? <div style={s.emptySmall}>No credits</div> : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "SOURCE", flex: 1.2 }, { label: "DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 0.6, align: "center" }]} />
                      {(m.credits || []).map((c) => (
                        <div key={c.id} style={s.tableRow}>
                          <EntryName name={c.name} note={c.note} every={c.every} />
                          <div style={{ flex: 1.2 }}><CategoryPill categoryName={c.category || c.source} categories={data.creditCategories || []} fallback={CREDIT_UNCATEGORIZED} /></div>
                          <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{c.date}</div>
                          <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#10b981" }}>+{fmt(c.amount)}</div>
                          <RowActions
                            id={c.id}
                            onEdit={() => setModal({ type: "credit", editId: c.id, monthKey: historyKey })}
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
            <>
              <div style={s.card}>
                <div style={s.cardTitle}>Saved So Far</div>
                <div style={{ fontSize: 40, fontWeight: 700, fontFamily: FONT, fontVariantNumeric: "tabular-nums",
                              color: savings.total >= 0 ? "#10b981" : "#ef4444", margin: "12px 0 4px" }}>
                  {fmt(savings.total)}
                </div>
                <div style={{ fontSize: 12, color: theme.textMuted }}>
                  Across {savings.monthsCounted} closed period{savings.monthsCounted !== 1 ? "s" : ""}
                </div>
              </div>

              <div style={{ ...s.card, marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={s.cardTitle}>Starting Balance</div>
                  <InfoHint text="Money you'd already saved before you started using Budget Ctrl. Everything after this is calculated from your closed periods — this just sets where the count begins." />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <input type="number" value={data.startingBalance || ""}
                    onChange={(e) => save({ ...data, startingBalance: +e.target.value || 0 })}
                    placeholder="0" style={{ ...s.input, width: 180 }} />
                  <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
                </div>
              </div>

              <div style={{ ...s.card, marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={s.cardTitle}>Savings Goal</div>
                  <InfoHint text="The total you're saving up to. Progress is measured against everything saved across closed periods, including your starting balance." />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                  <input type="number" min={0} value={savingsGoal.target || ""} placeholder="0"
                    onChange={(e) => save({ ...data, savingsGoal: { ...savingsGoal, target: Math.max(0, Math.floor(+e.target.value) || 0) } })}
                    style={{ ...s.input, width: 180 }} />
                  <span style={{ ...TYPE.caption, color: theme.textMuted, fontWeight: 600 }}>{data.currency}</span>
                </div>
                {savingsGoal.target > 0 ? (() => {
                  const remainingToGoal = savingsGoal.target - savings.total;
                  // Pace comes from closed periods only, so it reflects what you
                  // actually saved rather than what you intended to.
                  const closed = savings.series.slice(1);
                  const avgDelta = closed.length ? closed.reduce((a, r) => a + r.delta, 0) / closed.length : 0;
                  const periodsLeft = remainingToGoal > 0 && avgDelta > 0 ? Math.ceil(remainingToGoal / avgDelta) : null;
                  return (
                    <div style={{ marginTop: 16 }}>
                      <GoalProgress saved={savings.total} target={savingsGoal.target} />
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                        <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint }}>
                          {fmt(Math.max(0, savings.total))} of {fmt(savingsGoal.target)}
                        </span>
                        <span style={{ ...TYPE.finePrint, lineHeight: 1.5, color: remainingToGoal <= 0 ? theme.success : theme.textFaint }}>
                          {remainingToGoal <= 0
                            ? "Goal reached"
                            : periodsLeft
                              ? `${fmt(remainingToGoal)} to go · about ${periodsLeft} more period${periodsLeft !== 1 ? "s" : ""} at your recent pace`
                              : `${fmt(remainingToGoal)} to go`}
                        </span>
                      </div>
                    </div>
                  );
                })() : (
                  <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: 8 }}>
                    Set a target to track progress against it.
                  </div>
                )}
              </div>

              <div style={{ ...s.card, marginTop: 16 }}>
                <div style={s.cardTitle}>Savings Over Time</div>
                <SavingsChart series={savings.series} />
              </div>

              <div style={{ ...s.card, marginTop: 16 }}>
                <div style={s.cardTitle}>Period by Period</div>
                {savings.series.length < 2 ? (
                  <div style={s.emptySmall}>Close out a period to start tracking savings.</div>
                ) : (
                  <>
                    <div style={{ ...TYPE.finePrint, lineHeight: 1.5, color: theme.textFaint, marginTop: SPACE.xs }}>
                      Income is editable here. For expenses, open the period.
                    </div>
                    <TableHeader columns={[
                      { label: "PERIOD", flex: 2 }, { label: "INCOME", flex: 1, align: "right" },
                      { label: "SPENT", flex: 1, align: "right" }, { label: "CHANGE", flex: 1, align: "right" },
                      { label: "BALANCE", flex: 1, align: "right" }, { label: "", flex: 0.8, align: "right" },
                    ]} />
                    {savings.series.slice(1).map((row) => (
                      <div key={row.key} style={s.tableRow}>
                        <div style={{ flex: 2, fontWeight: 600, display: "flex", alignItems: "center", gap: SPACE.xs }}>
                          {periodLabel(row.key, cutoffDay).primary}
                          {row.editedAt && (
                            <span
                              title={`Edited after this period closed, on ${new Date(row.editedAt).toLocaleDateString()}`}
                              style={{ ...TYPE.microLegal, color: theme.textFaint, border: `1px solid ${theme.border}`, borderRadius: RADIUS.pill, padding: "1px 7px", fontWeight: 400 }}
                            >edited</span>
                          )}
                        </div>
                        <div style={{ flex: 1 }}>
                          <InlineNumber
                            value={data.months[row.key]?.income || 0}
                            title="Base income for this period"
                            onChange={(v) => patchMonth(row.key, { income: v })}
                          />
                        </div>
                        <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", color: theme.textMuted }}>{fmt(row.spent)}</div>
                        <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: row.delta >= 0 ? "#10b981" : "#ef4444" }}>{row.delta >= 0 ? "+" : ""}{fmt(row.delta)}</div>
                        <div style={{ flex: 1, textAlign: "right", fontFamily: FONT, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(row.balance)}</div>
                        <div style={{ flex: 0.8, textAlign: "right" }}>
                          <button
                            style={{ ...s.linkBtn, padding: 0 }}
                            title="Open this period to edit its expenses, recurring items and credits"
                            onClick={() => { setTab("history"); setHistoryKey(row.key); }}
                          >Open →</button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
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
          <FormModal title={editing ? "Edit Expense" : "Add Expense"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Groceries", defaultValue: editing?.name },
            { key: "amount", label: `Amount (${currencyCode()})`, type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "date", label: "Date", type: "date", defaultValue: editing?.date || `${targetKey}-01` },
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
                    expenses: targetMonth.expenses.map((x) => x.id === editing.id
                      ? { ...x, name: v.name, amount: +v.amount, date: v.date, category: category.name, note: cleanNote(v.note) }
                      : x),
                  },
                },
              });
            } else {
              const newExp = { id: uid(), name: v.name, amount: +v.amount, date: v.date, category: category.name, note: cleanNote(v.note) };
              save({
                ...data,
                categories,
                months: { ...data.months, [targetKey]: { ...targetMonth, expenses: [...targetMonth.expenses, newExp] } },
              });
            }
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
        // A bill not due this period has no instance here, only its template.
        const editingTpl = modal.templateId ? (data.recurringTemplate || []).find((x) => x.id === modal.templateId) : null;
        const tplOf = editing ? (data.recurringTemplate || []).find((x) => x.id === editing.templateId) : null;
        const source = editingTpl || editing;
        const sched = editingTpl || tplOf || editing || {};
        return (
          <FormModal title={source ? "Edit Recurring Payment" : "Add Recurring Payment"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Rent", defaultValue: source?.name },
            { key: "amount", label: `Amount (${currencyCode()})`, type: "number", placeholder: "0", defaultValue: source ? String(source.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: source?.category },
            { key: "dayOfMonth", label: "Day of Month", type: "number", placeholder: "1", defaultValue: source ? String(source.dayOfMonth) : "" },
            // Frequency belongs to the template, so it is offered only where the
            // template is being edited - not on a correction to a past period.
            ...(touchesTemplate ? [
              { key: "repeats", label: "Repeats", type: "select", options: FREQUENCIES.map((f) => f.label), defaultValue: frequencyLabel(sched.every) },
              { key: "anchor", label: "First due in", type: "month", defaultValue: sched.anchor || targetKey },
            ] : []),
            { key: "autoPay", label: "Pays itself", type: "checkbox", defaultValue: source?.autoPay,
              hint: "Direct debit or card on file. Never sends a reminder." },
            NOTE_FIELD(source),
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const { categories, category } = ensureCategory(data.categories, v.category);
            const fields = { name: v.name, amount: +v.amount, dayOfMonth: +v.dayOfMonth || 1, category: category.name,
                             autoPay: !!v.autoPay, note: cleanNote(v.note) };
            const every = touchesTemplate ? everyFromLabel(v.repeats) : (sched.every || 1);
            // Monthly items carry no schedule at all, exactly like items saved
            // before frequencies existed.
            const schedule = every > 1
              ? { every, anchor: v.anchor || sched.anchor || targetKey }
              : { every: undefined, anchor: undefined };
            const dueNow = isOnCycle(schedule, curKey);

            if (editingTpl) {
              const tpl = { ...editingTpl, ...fields, ...schedule };
              const has = cur.recurring.some((r) => r.templateId === tpl.id);
              save({
                ...data, categories,
                recurringTemplate: data.recurringTemplate.map((x) => x.id === tpl.id ? tpl : x),
                // Rescheduled into this period: give it an instance now, since the
                // rollover that would have created one has already happened.
                months: dueNow && !has
                  ? { ...data.months, [curKey]: { ...cur, recurring: [...cur.recurring, { ...tpl, id: uid(), templateId: tpl.id }] } }
                  : data.months,
              });
            } else if (editing) {
              const updatedItem = { ...editing, ...fields, ...(touchesTemplate ? schedule : {}) };
              // Rescheduled out of this period: this instance goes, the template stays.
              const nextRecurring = touchesTemplate && !dueNow
                ? targetMonth.recurring.filter((x) => x.id !== editing.id)
                : targetMonth.recurring.map((x) => x.id === editing.id ? updatedItem : x);
              save({
                ...data, categories,
                months: { ...data.months, [targetKey]: { ...targetMonth, recurring: nextRecurring } },
                recurringTemplate: touchesTemplate
                  ? data.recurringTemplate.map((x) => x.id === editing.templateId ? { ...x, ...fields, ...schedule } : x)
                  : data.recurringTemplate,
              });
            } else {
              const tid = uid();
              const tpl = { id: tid, ...fields, ...(touchesTemplate ? schedule : {}) };
              // A past-period add is a one-off correction with no template; a
              // current-period add appears here only if it is due here.
              const addHere = !touchesTemplate || dueNow;
              save({
                ...data, categories,
                months: addHere
                  ? { ...data.months, [targetKey]: { ...targetMonth, recurring: [...targetMonth.recurring, { ...tpl, id: uid(), templateId: tid }] } }
                  : data.months,
                recurringTemplate: touchesTemplate ? [...data.recurringTemplate, tpl] : data.recurringTemplate,
              });
            }
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "upcoming" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const editing = modal.editId ? targetMonth.upcoming.find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Upcoming Payment" : "Add Upcoming Payment"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Car Insurance", defaultValue: editing?.name },
            { key: "amount", label: `Amount (${currencyCode()})`, type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "dueDate", label: "Due Date", type: "date", defaultValue: editing?.dueDate || `${targetKey}-01` },
            { key: "autoPay", label: "Pays itself", type: "checkbox", defaultValue: editing?.autoPay,
              hint: "Direct debit or card on file. Counts as paid on its due date and never sends a reminder." },
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
        const editingTpl = modal.templateId ? (data.creditTemplate || []).find((x) => x.id === modal.templateId) : null;
        const tplOf = editing ? (data.creditTemplate || []).find((x) => x.id === editing.templateId) : null;
        const source = editingTpl || editing;
        const sched = editingTpl || tplOf || editing || {};
        return (
          <FormModal title={source ? "Edit Recurring Credit" : "Add Recurring Credit"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Allowance", defaultValue: source?.name },
            { key: "amount", label: `Amount (${currencyCode()})`, type: "number", placeholder: "0", defaultValue: source ? String(source.amount) : "" },
            { key: "category", label: "Source", type: "category", categories: data.creditCategories || [], defaultValue: source?.category },
            { key: "dayOfMonth", label: "Day of Month", type: "number", placeholder: "1", defaultValue: source ? String(source.dayOfMonth) : "" },
            // Frequency belongs to the template, so it is offered only where the
            // template is being edited - not on a correction to a past period.
            ...(touchesTemplate ? [
              { key: "repeats", label: "Repeats", type: "select", options: FREQUENCIES.map((f) => f.label), defaultValue: frequencyLabel(sched.every) },
              { key: "anchor", label: "First due in", type: "month", defaultValue: sched.anchor || targetKey },
            ] : []),
            NOTE_FIELD(source),
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const amt = +v.amount;
            if (!v.name || !(amt > 0)) { setModal(null); return; }
            const { categories: creditCategories, category } = ensureCreditCategory(data.creditCategories || [], v.category);
            const fields = { name: v.name, amount: amt, dayOfMonth: +v.dayOfMonth || 1, category: category.name, note: cleanNote(v.note) };
            const every = touchesTemplate ? everyFromLabel(v.repeats) : (sched.every || 1);
            const schedule = every > 1
              ? { every, anchor: v.anchor || sched.anchor || targetKey }
              : { every: undefined, anchor: undefined };
            const dueNow = isOnCycle(schedule, curKey);
            const curCredits = cur.credits || [];
            const tmpl = data.creditTemplate || [];

            if (editingTpl) {
              const tpl = { ...editingTpl, ...fields, ...schedule };
              const has = curCredits.some((c) => c.templateId === tpl.id);
              save({
                ...data, creditCategories,
                creditTemplate: tmpl.map((x) => x.id === tpl.id ? tpl : x),
                months: dueNow && !has
                  ? { ...data.months, [curKey]: { ...cur, credits: [...curCredits, { ...tpl, id: uid(), templateId: tpl.id }] } }
                  : data.months,
              });
            } else if (editing) {
              const updated = { ...editing, ...fields, ...(touchesTemplate ? schedule : {}) };
              const credits = targetMonth.credits || [];
              const nextCredits = touchesTemplate && !dueNow
                ? credits.filter((x) => x.id !== editing.id)
                : credits.map((x) => x.id === editing.id ? updated : x);
              save({
                ...data, creditCategories,
                months: { ...data.months, [targetKey]: { ...targetMonth, credits: nextCredits } },
                creditTemplate: touchesTemplate
                  ? tmpl.map((x) => x.id === editing.templateId ? { ...x, ...fields, ...schedule } : x)
                  : tmpl,
              });
            } else {
              const tid = uid();
              const tpl = { id: tid, ...fields, ...(touchesTemplate ? schedule : {}) };
              const addHere = !touchesTemplate || dueNow;
              save({
                ...data, creditCategories,
                months: addHere
                  ? { ...data.months, [targetKey]: { ...targetMonth, credits: [...(targetMonth.credits || []), { ...tpl, id: uid(), templateId: tid }] } }
                  : data.months,
                creditTemplate: touchesTemplate ? [...tmpl, tpl] : tmpl,
              });
            }
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "credit" && (() => {
        const targetKey = modal.monthKey || curKey;
        const targetMonth = data.months[targetKey] || emptyMonth();
        const editing = modal.editId ? (targetMonth.credits || []).find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Credit" : "Add Credit"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Amazon refund", defaultValue: editing?.name },
            { key: "amount", label: `Amount (${currencyCode()})`, type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Source", type: "category", categories: data.creditCategories || [], defaultValue: editing?.category || editing?.source },
            { key: "date", label: "Date", type: "date", defaultValue: editing?.date || `${targetKey}-01` },
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
            if (counts.expenses) parts.push(`${counts.expenses} expense${counts.expenses !== 1 ? "s" : ""}`);
            if (counts.credits) parts.push(`${counts.credits} credit${counts.credits !== 1 ? "s" : ""}`);
            if (counts.markedPaid) parts.push(`${counts.markedPaid} payment${counts.markedPaid !== 1 ? "s" : ""} marked paid`);
            alert(`Imported ${parts.join(", ") || "nothing"}.` +
              (isTauri ? "\n\nA backup was taken first — restore it from Settings → Data if anything looks wrong." : ""));
          }} />
      )}

      {categoriesOpen && (
        <CategoryManager data={data} onClose={() => setCategoriesOpen(false)} onChange={(next) => save(next)} />
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
          onExport={() => exportData(data)}
          onExportCsv={() => exportCsv(data)}
          onImport={triggerImport}
          onImportStatement={() => { setSettingsOpen(false); setStatementOpen(true); }}
          onReset={resetAll}
          onChangeCurrency={(currency) => save({ ...data, currency })}
          onChangeLocale={(locale) => save({ ...data, locale })}
          onManageCategories={() => { setSettingsOpen(false); setCategoriesOpen(true); }}
          onRestore={async (name) => {
            if (!confirm(`Replace all current data with the backup "${name}"?

What you have now is backed up first.`)) return;
            try {
              const text = await readBackup(name);
              const parsed = JSON.parse(text);
              if (!parsed || typeof parsed !== "object" || !parsed.months) {
                alert("That backup could not be read.");
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
              alert("That backup could not be read.");
            }
          }}
        />
      )}
    </div>
    </DeleteArmContext.Provider>
    </ThemeContext.Provider>
  );
}
