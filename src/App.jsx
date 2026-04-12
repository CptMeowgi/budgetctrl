if (!window.storage) {
  window.storage = {
    get: async (key) => {
      const val = localStorage.getItem(key);
      return val ? { value: val } : null;
    },
    set: async (key, value) => {
      localStorage.setItem(key, value);
      return { key, value };
    },
  };
}
import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer, XAxis, YAxis, CartesianGrid, BarChart, Bar } from "recharts";

const THEME = {
  bg: "#f4f5f7",
  surface: "#ffffff",
  border: "#e5e7eb",
  text: "#0c0d12",
  textMuted: "#6b7280",
  textFaint: "#9ca3af",
  accent: "#0066ff",
  accentSoft: "rgba(0,102,255,0.08)",
  success: "#10b981",
  danger: "#ef4444",
  warning: "#f59e0b",
  shadowCard: "0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)",
  // Phase 1b — outer dark frame
  outerBg: "#0c0d12",
  outerText: "#e5e7eb",
  outerTextMuted: "#9ca3af",
  outerBorder: "#1f2028",
  outerAccentSoft: "rgba(0,102,255,0.15)",
};

// Phase 5 — light panel theme is just THEME aliased (current default)
const THEME_LIGHT_PANEL = THEME;

// Phase 5 — dark panel theme overrides inner-panel surfaces only.
// outerBg, outerText, outerBorder, accent, success, danger, warning are unchanged
// (the dark sidebar/topbar frame stays as brand identity in both modes).
const THEME_DARK_PANEL = {
  ...THEME,
  bg: "#1a1b22",
  surface: "#25262d",
  border: "#2f3038",
  text: "#e5e7eb",
  textMuted: "#9ca3af",
  textFaint: "#6b7280",
  shadowCard: "0 1px 2px rgba(0,0,0,0.3), 0 1px 3px rgba(0,0,0,0.4)",
  accentSoft: "rgba(0,102,255,0.18)",
};

const CATEGORY_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#0066ff", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const CATEGORY_ICONS = ["🍔", "🚗", "🛍️", "📄", "🎮", "💊", "💰", "🏠", "✈️", "🎁", "☕", "📱"];
const UNCATEGORIZED = { name: "Uncategorized", color: "#9ca3af", icon: "·" };

const STORAGE_KEY = "budget-app-data";
const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "◉" },
  { id: "expenses", label: "Expenses", icon: "↗" },
  { id: "recurring", label: "Recurring", icon: "↻" },
  { id: "upcoming", label: "Upcoming", icon: "◈" },
  { id: "credits", label: "Credits", icon: "+" },
  { id: "history", label: "History", icon: "◷" },
  { id: "year", label: "Year", icon: "▦" },
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmt(n) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(n);
}

function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonthKey() {
  return monthKey(new Date());
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function prevMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return monthKey(d);
}

function emptyMonth() {
  return { income: 0, expenses: [], recurring: [], upcoming: [], credits: [] };
}

function defaultData() {
  const cur = currentMonthKey();
  return {
    months: { [cur]: emptyMonth() },
    savingsGoalPercent: 20,
    recurringTemplate: [],
    categories: [{ ...UNCATEGORIZED }],
  };
}

function exportData(data) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `budget-ctrl-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function normalizeCatName(name) {
  return (name || "").trim();
}

function findCategory(categories, name) {
  const n = normalizeCatName(name).toLowerCase();
  if (!n) return null;
  return categories.find((c) => c.name.toLowerCase() === n) || null;
}

function ensureCategory(categories, name) {
  const trimmed = normalizeCatName(name);
  if (!trimmed) return { categories, category: UNCATEGORIZED };
  const existing = findCategory(categories, trimmed);
  if (existing) return { categories, category: existing };
  const userCats = categories.filter((c) => c.name !== "Uncategorized");
  const idx = userCats.length;
  const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
  const icon = CATEGORY_ICONS[idx % CATEGORY_ICONS.length];
  const newCat = { name: trimmed, color, icon };
  return { categories: [...categories, newCat], category: newCat };
}

function migrateCategories(data) {
  const categories = Array.isArray(data.categories) ? [...data.categories] : [];
  if (!categories.find((c) => c.name === "Uncategorized")) {
    categories.unshift({ ...UNCATEGORIZED });
  }
  const months = { ...data.months };
  for (const key of Object.keys(months)) {
    const m = months[key];
    const fix = (arr) => arr.map((e) => e.category ? e : { ...e, category: "Uncategorized" });
    months[key] = {
      ...m,
      expenses: fix(m.expenses || []),
      recurring: fix(m.recurring || []),
      upcoming: fix(m.upcoming || []),
    };
  }
  const template = (data.recurringTemplate || []).map((r) => r.category ? r : { ...r, category: "Uncategorized" });
  return { ...data, months, recurringTemplate: template, categories };
}

function migrateCredits(data) {
  const months = { ...data.months };
  for (const key of Object.keys(months)) {
    const m = months[key];
    if (!Array.isArray(m.credits)) {
      months[key] = { ...m, credits: [] };
    }
  }
  return { ...data, months };
}

function spentByCategory(month) {
  const totals = new Map();
  for (const e of (month.expenses || [])) {
    totals.set(e.category, (totals.get(e.category) || 0) + e.amount);
  }
  for (const r of (month.recurring || [])) {
    totals.set(r.category, (totals.get(r.category) || 0) + r.amount);
  }
  return totals;
}

function filterAndSort(arr, view) {
  let out = arr;
  if (view.search) {
    const q = view.search.toLowerCase();
    out = out.filter((x) => (x.name || "").toLowerCase().includes(q));
  }
  if (view.sortCol) {
    out = [...out].sort((a, b) => {
      const av = a[view.sortCol], bv = b[view.sortCol];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return view.sortDir === "asc" ? cmp : -cmp;
    });
  }
  return out;
}

function categoryAverage(data, categoryName, excludeKey) {
  const keys = Object.keys(data.months).filter((k) => k !== excludeKey);
  if (keys.length === 0) return null;
  let total = 0;
  for (const k of keys) {
    const m = data.months[k];
    for (const e of (m.expenses || [])) if (e.category === categoryName) total += e.amount;
    for (const r of (m.recurring || [])) if (r.category === categoryName) total += r.amount;
  }
  return total / keys.length;
}

function migrate(raw) {
  if (!raw || typeof raw !== "object") return defaultData();
  if (raw.months && raw.recurringTemplate) return raw;
  const cur = currentMonthKey();
  const months = {};
  const oldExpenses = Array.isArray(raw.expenses) ? raw.expenses : [];
  const oldUpcoming = Array.isArray(raw.upcoming) ? raw.upcoming : [];
  const oldRecurring = Array.isArray(raw.recurring) ? raw.recurring : [];

  months[cur] = emptyMonth();
  months[cur].income = Number(raw.monthlyIncome) || 0;
  months[cur].recurring = oldRecurring.map((r) => ({ ...r }));

  for (const e of oldExpenses) {
    const k = monthKey(e.date) || cur;
    if (!months[k]) months[k] = emptyMonth();
    months[k].expenses.push(e);
  }
  for (const u of oldUpcoming) {
    const k = monthKey(u.dueDate) || cur;
    if (!months[k]) months[k] = emptyMonth();
    months[k].upcoming.push(u);
  }

  return {
    months,
    savingsGoalPercent: Number(raw.savingsGoalPercent) || 20,
    recurringTemplate: oldRecurring.map((r) => ({ ...r })),
  };
}

function ensureCurrentMonth(data) {
  const cur = currentMonthKey();
  if (data.months[cur]) return data;
  const prev = prevMonthKey(cur);
  const carriedIncome = data.months[prev]?.income || 0;
  return {
    ...data,
    months: {
      ...data.months,
      [cur]: {
        income: carriedIncome,
        expenses: [],
        recurring: (data.recurringTemplate || []).map((r) => ({ ...r, id: uid() })),
        upcoming: [],
        credits: [],
      },
    },
  };
}

function categoryBreakdown(month, categories) {
  const totals = new Map();
  for (const item of [...(month.expenses || []), ...(month.recurring || [])]) {
    const name = item.category || "Uncategorized";
    totals.set(name, (totals.get(name) || 0) + item.amount);
  }
  return Array.from(totals.entries()).map(([name, value]) => {
    const cat = categories.find((c) => c.name === name) || { color: "#9ca3af", icon: "·" };
    return { name, value, color: cat.color, icon: cat.icon };
  }).sort((a, b) => b.value - a.value);
}

function monthlyTotals(data) {
  return Object.keys(data.months).sort().map((key) => {
    const m = data.months[key];
    const spent = (m.expenses || []).reduce((a, e) => a + e.amount, 0)
                + (m.recurring || []).reduce((a, e) => a + e.amount, 0);
    const credits = (m.credits || []).reduce((a, c) => a + c.amount, 0);
    return { key, label: monthLabel(key).slice(0, 3), spent, income: (m.income || 0) + credits };
  });
}

function Modal({ title, onClose, children }) {
  const { theme, s } = useThemed();
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} style={s.closeBtn}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CategoryPicker({ value, onChange, categories }) {
  const { theme, s } = useThemed();
  const [open, setOpen] = useState(false);
  const suggestions = categories.filter((c) => {
    if (c.name === "Uncategorized") return false;
    if (!value) return true;
    return c.name.toLowerCase().includes(value.toLowerCase());
  });
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        placeholder="e.g. Food, Transport"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={s.input}
      />
      {open && suggestions.length > 0 && (
        <div style={s.suggestBox}>
          {suggestions.map((c) => (
            <div key={c.name} style={s.suggestItem}
              onMouseDown={(e) => { e.preventDefault(); onChange(c.name); setOpen(false); }}>
              <span style={{ ...s.catDot, background: `${c.color}25` }}>{c.icon}</span>
              <span>{c.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FormModal({ title, fields, onClose, onSave }) {
  const { theme, s } = useThemed();
  const [vals, setVals] = useState(() => {
    const init = {};
    fields.forEach((f) => { init[f.key] = f.defaultValue || ""; });
    return init;
  });
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: fields.length > 3 ? "1fr 1fr" : "1fr", gap: 16, padding: "20px 0" }}>
        {fields.map((f) => (
          <div key={f.key}>
            <label style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 }}>{f.label}</label>
            {f.type === "select" ? (
              <select value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} style={s.input}>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "category" ? (
              <CategoryPicker value={vals[f.key] || ""} onChange={(v) => setVals({ ...vals, [f.key]: v })} categories={f.categories} />
            ) : f.type === "number" ? (
              <input type="text" inputMode="decimal" placeholder={f.placeholder}
                value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                style={s.input} />
            ) : (
              <input type={f.type || "text"} placeholder={f.placeholder}
                value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
                style={s.input} />
            )}
          </div>
        ))}
      </div>
      {(() => {
        const amountNum = parseFloat(String(vals.amount).replace(",", "."));
        const valid = vals.name?.trim() && !isNaN(amountNum);
        return (
          <button
            style={{ ...s.saveBtn, opacity: valid ? 1 : 0.5, cursor: valid ? "pointer" : "not-allowed" }}
            disabled={!valid}
            onClick={() => onSave({ ...vals, amount: amountNum })}
          >
            {valid ? "Save" : "Fill in name and amount"}
          </button>
        );
      })()}
    </Modal>
  );
}

function StatCard({ label, value, accent, sub, icon }) {
  const { theme, s } = useThemed();
  return (
    <div style={{ ...s.statCard, borderTop: `3px solid ${accent}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: theme.textMuted, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 20, opacity: 0.3 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent, fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", margin: "8px 0 4px" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: theme.textMuted }}>{sub}</div>}
    </div>
  );
}

function TableHeader({ columns, sortCol, sortDir, onSort }) {
  const { theme, s } = useThemed();
  return (
    <div style={s.tableHeader}>
      {columns.map((col, i) => {
        const isSortable = col.sortKey && onSort;
        const isActive = sortCol === col.sortKey;
        const arrow = isActive ? (sortDir === "asc" ? " ↑" : " ↓") : "";
        return (
          <div key={i} style={{
            flex: col.flex,
            textAlign: col.align || "left",
            cursor: isSortable ? "pointer" : "default",
            userSelect: "none",
          }} onClick={isSortable ? () => onSort(col.sortKey) : undefined}>
            {col.label}{arrow}
          </div>
        );
      })}
    </div>
  );
}

function CategoryPill({ categoryName, categories }) {
  const { theme, s } = useThemed();
  const cat = findCategory(categories, categoryName) || UNCATEGORIZED;
  return (
    <span style={{ ...s.catPill, background: `${cat.color}15`, color: cat.color }}>
      <span style={{ ...s.catDot, background: `${cat.color}25` }}>{cat.icon}</span>
      {cat.name}
    </span>
  );
}

function CategoryDonut({ data, total }) {
  const { theme, s } = useThemed();
  if (!data.length) {
    return <div style={s.chartEmpty}>Add expenses to see category breakdown.</div>;
  }
  return (
    <div style={{ position: "relative", width: "100%", height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={70} outerRadius={100} paddingAngle={2} stroke="none">
            {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
          </Pie>
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{d.icon} {d.name}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums" }}>{fmt(d.value)} · {pct}%</div>
              </div>
            );
          }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Total</div>
        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", color: theme.text }}>{fmt(total)}</div>
      </div>
    </div>
  );
}

function MonthlyBarChart({ data, curKey, onBarClick }) {
  const { theme, s } = useThemed();
  if (data.length < 2) {
    return <div style={s.chartEmpty}>Come back next month to see trends.</div>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <CartesianGrid stroke={theme.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={theme.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.key}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", color: theme.danger }}>Spent: {fmt(d.spent)}</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", color: theme.textMuted }}>Income: {fmt(d.income)}</div>
              </div>
            );
          }} />
          <Bar
            dataKey="spent"
            radius={[6, 6, 0, 0]}
            onClick={(d) => { if (d && d.key !== curKey) onBarClick?.(d.key); }}
          >
            {data.map((d) => (
              <Cell
                key={d.key}
                fill={d.spent > d.income ? theme.danger : theme.accent}
                style={{ cursor: d.key !== curKey ? "pointer" : "default" }}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryBudgets({ categories, spent, average, onSetCap }) {
  const { theme, s } = useThemed();
  const [editing, setEditing] = useState(null);
  const [draftCap, setDraftCap] = useState("");

  const startEdit = (c) => {
    setEditing(c.name);
    setDraftCap(c.cap != null ? String(c.cap) : "");
  };
  const commitEdit = () => {
    const n = parseFloat(String(draftCap).replace(",", "."));
    onSetCap(editing, isFinite(n) && n > 0 ? n : null);
    setEditing(null);
  };
  const cancelEdit = () => setEditing(null);

  const rows = categories
    .filter((c) => c.name !== "Uncategorized")
    .map((c) => {
      const sp = spent.get(c.name) || 0;
      const pct = c.cap ? (sp / c.cap) * 100 : null;
      return { ...c, sp, pct };
    })
    .sort((a, b) => {
      if (a.pct == null && b.pct == null) return a.name.localeCompare(b.name);
      if (a.pct == null) return 1;
      if (b.pct == null) return -1;
      return b.pct - a.pct;
    });

  if (rows.length === 0) {
    return <div style={s.empty}>No categories yet. Add an expense to start tracking.</div>;
  }

  return (
    <div>
      {rows.map((r) => {
        const isEditing = editing === r.name;
        const avg = average(r.name);
        const barColor = r.pct == null ? theme.border
          : r.pct > 100 ? theme.danger
          : r.pct > 80 ? theme.warning
          : theme.accent;
        return (
          <div key={r.name} style={{ padding: "12px 0", borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: r.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{r.icon}</div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!isEditing && (
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontSize: 12, color: theme.textMuted }}>
                    {fmt(r.sp)} / {r.cap != null ? fmt(r.cap) : "—"}
                  </span>
                )}
                {!isEditing && (
                  <button style={s.editBtn} onClick={() => startEdit(r)}>{r.cap != null ? "✎" : "+"}</button>
                )}
                {isEditing && (
                  <>
                    <input type="text" inputMode="decimal" autoFocus
                      value={draftCap}
                      placeholder="Cap"
                      onChange={(e) => setDraftCap(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                      style={{ width: 80, ...s.input, padding: "6px 10px", fontSize: 12 }} />
                    <button style={s.editBtn} onClick={commitEdit}>✓</button>
                    <button style={s.delBtn} onClick={cancelEdit}>✕</button>
                  </>
                )}
              </div>
            </div>
            {r.cap != null && (
              <div style={{ height: 6, background: theme.bg, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, r.pct)}%`, height: "100%", background: barColor, transition: "width .3s" }} />
              </div>
            )}
            {avg != null && (
              <div style={{ fontSize: 11, color: theme.textFaint, marginTop: 4 }}>
                avg of past months: {fmt(avg)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(defaultData());
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [historyKey, setHistoryKey] = useState(null);
  const [yearKey, setYearKey] = useState(() => String(new Date().getFullYear()));
  const importInputRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [themeMode, setThemeMode] = useState(() => {
    try { return localStorage.getItem("themeMode") || "light"; } catch { return "light"; }
  });
  const [expensesView, setExpensesView] = useState({ search: "", sortCol: null, sortDir: "asc" });
  const [recurringView, setRecurringView] = useState({ search: "", sortCol: null, sortDir: "asc" });
  const [upcomingView, setUpcomingView] = useState({ search: "", sortCol: null, sortDir: "asc" });
  const [creditsView, setCreditsView] = useState({ search: "", sortCol: null, sortDir: "asc" });
  const triggerImport = () => importInputRef.current?.click();
  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== "object" || !parsed.months || typeof parsed.months !== "object") {
          alert("Could not read backup file. Make sure it's a valid budget-ctrl JSON export.");
          return;
        }
        if (!confirm("Replace ALL current data with the contents of this backup? This cannot be undone.")) return;
        const migrated = migrateCredits(migrateCategories(ensureCurrentMonth(migrate(parsed))));
        save(migrated);
      } catch {
        alert("Could not read backup file. Make sure it's a valid budget-ctrl JSON export.");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(STORAGE_KEY);
        if (r?.value) {
          const raw = JSON.parse(r.value);
          const migrated = migrateCredits(migrateCategories(ensureCurrentMonth(migrate(raw))));
          setData(migrated);
          if (migrated !== raw) {
            try { await window.storage.set(STORAGE_KEY, JSON.stringify(migrated)); } catch {}
          }
        } else {
          setData(migrateCredits(migrateCategories(ensureCurrentMonth(defaultData()))));
        }
      } catch {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!pendingDelete) return;
    const t = setTimeout(() => setPendingDelete(null), 3000);
    return () => clearTimeout(t);
  }, [pendingDelete]);

  useEffect(() => {
    try { localStorage.setItem("themeMode", themeMode); } catch {}
  }, [themeMode]);

  const themedValue = useMemo(() => {
    const theme = themeMode === "dark" ? THEME_DARK_PANEL : THEME_LIGHT_PANEL;
    return { theme, s: makeStyles(theme) };
  }, [themeMode]);
  const { theme, s } = themedValue;

  const save = useCallback(async (next) => {
    setData(next);
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(next)); } catch {}
  }, []);

  const patchCur = useCallback((patch) => {
    const key = currentMonthKey();
    const curMonth = data.months[key] || emptyMonth();
    save({
      ...data,
      months: { ...data.months, [key]: { ...curMonth, ...patch } },
    });
  }, [data, save]);

  if (!loaded) return <div style={s.shell}><div style={{ color: "#6b7280", textAlign: "center", marginTop: 200, fontSize: 14 }}>Loading...</div></div>;

  const curKey = currentMonthKey();
  const cur = data.months[curKey] || emptyMonth();

  const totalExpenses = cur.expenses.reduce((a, e) => a + e.amount, 0);
  const totalRecurring = cur.recurring.reduce((a, e) => a + e.amount, 0);
  const totalUnpaidUpcoming = cur.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
  const totalAllUpcoming = cur.upcoming.reduce((a, e) => a + e.amount, 0);
  const totalCredits = (cur.credits || []).reduce((a, c) => a + c.amount, 0);
  const baseIncome = cur.income;
  const effectiveIncome = baseIncome + totalCredits;
  const totalCommitted = totalExpenses + totalRecurring + totalAllUpcoming;
  const availableAfterCommitted = Math.max(0, effectiveIncome - totalCommitted);
  const maxSavingsPct = baseIncome > 0
    ? Math.min(50, Math.max(0, Math.floor((availableAfterCommitted / baseIncome) * 100)))
    : 0;
  const displayPct = Math.min(data.savingsGoalPercent, maxSavingsPct);
  const savingsTarget = (baseIncome * displayPct) / 100;
  const canInvest = Math.max(0, availableAfterCommitted - savingsTarget);
  const remaining = effectiveIncome - totalCommitted;
  const unpaidCount = cur.upcoming.filter((u) => !u.paid).length;
  const totalUpcoming = totalUnpaidUpcoming;

  const catBreakdown = categoryBreakdown(cur, data.categories || []);
  const catTotal = catBreakdown.reduce((a, c) => a + c.value, 0);
  const monthlyData = monthlyTotals(data);
  const spentByCat = spentByCategory(cur);
  const onSortExpenses = (col) => {
    setExpensesView((v) => ({ ...v, sortCol: col, sortDir: v.sortCol === col && v.sortDir === "asc" ? "desc" : "asc" }));
  };
  const filteredExpenses = filterAndSort(cur.expenses, expensesView);
  const onSortRecurring = (col) => {
    setRecurringView((v) => ({ ...v, sortCol: col, sortDir: v.sortCol === col && v.sortDir === "asc" ? "desc" : "asc" }));
  };
  const filteredRecurring = filterAndSort(cur.recurring, recurringView);
  const onSortUpcoming = (col) => {
    setUpcomingView((v) => ({ ...v, sortCol: col, sortDir: v.sortCol === col && v.sortDir === "asc" ? "desc" : "asc" }));
  };
  const filteredUpcoming = filterAndSort(cur.upcoming, upcomingView);
  const onSortCredits = (col) => {
    setCreditsView((v) => ({ ...v, sortCol: col, sortDir: v.sortCol === col && v.sortDir === "asc" ? "desc" : "asc" }));
  };
  const filteredCredits = filterAndSort(cur.credits || [], creditsView);
  const onSetCap = (name, newCap) => {
    save({
      ...data,
      categories: data.categories.map((c) => c.name === name
        ? (newCap == null ? { ...c, cap: undefined } : { ...c, cap: newCap })
        : c),
    });
  };

  return (
    <ThemeContext.Provider value={themedValue}>
    <div style={s.shell}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap" rel="stylesheet" />

      {/* SIDEBAR */}
      <aside style={s.sidebar}>
        <div style={s.logo}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5, color: "#ffffff" }}>BUDGET</div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: theme.accent, fontWeight: 700 }}>CTRL</div>
        </div>
        <nav style={s.nav}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); if (t.id !== "history") setHistoryKey(null); }}
              style={tab === t.id ? { ...s.navItem, ...s.navItemActive } : s.navItem}>
              <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{t.icon}</span>
              <span>{t.label}</span>
              {t.id === "upcoming" && unpaidCount > 0 && <span style={s.badge}>{unpaidCount}</span>}
            </button>
          ))}
        </nav>
        <div style={s.sidebarIncome}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: theme.outerTextMuted, marginBottom: 8, fontWeight: 600 }}>Monthly Income</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="number" value={cur.income || ""}
              onChange={(e) => patchCur({ income: +e.target.value || 0 })}
              placeholder="0" style={s.incomeInput} />
            <span style={{ fontSize: 12, color: theme.outerTextMuted, fontWeight: 600 }}>PLN</span>
          </div>
          {totalCredits > 0 && (
            <div style={{ fontSize: 11, color: "#10b981", marginTop: 6, fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums" }}>
              + {fmt(totalCredits)} credits
            </div>
          )}
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid " + theme.outerBorder }}>
          <div style={{ fontSize: 10, color: theme.outerTextMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>DATA</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button style={s.dataLink} onClick={() => exportData(data)}>EXPORT</button>
            <button style={s.dataLink} onClick={triggerImport}>IMPORT</button>
            <button style={s.dataLink} onClick={async () => { if (confirm("Reset all data?")) await save(migrateCredits(migrateCategories(ensureCurrentMonth(defaultData())))); }}>RESET</button>
          </div>
          <input type="file" accept=".json" ref={importInputRef} onChange={onImportFile} style={{ display: "none" }} />
        </div>
      </aside>

      {/* MAIN */}
      <main style={s.main}>
        <header style={s.topbar}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: -0.5, color: "#ffffff" }}>
              {TABS.find((t) => t.id === tab)?.label}
            </h1>
            <div style={{ fontSize: 12, color: theme.outerTextMuted, marginTop: 2 }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            <button
              style={s.themeToggle}
              onClick={() => setThemeMode((m) => m === "dark" ? "light" : "dark")}
              title={themeMode === "dark" ? "Switch to light panel" : "Switch to dark panel"}
            >
              {themeMode === "dark" ? "☀" : "☾"}
            </button>
            {tab !== "dashboard" && tab !== "history" && tab !== "year" && (
              <button style={s.addBtn} onClick={() => setModal({ type: tab === "expenses" ? "expense" : tab === "credits" ? "credit" : tab })}>
                + Add {tab === "expenses" ? "Expense" : tab === "recurring" ? "Recurring" : tab === "credits" ? "Credit" : "Payment"}
              </button>
            )}
          </div>
        </header>

        <div style={s.content}>
          <div style={s.contentInner}>
          {/* DASHBOARD */}
          {tab === "dashboard" && (
            <>
              <div style={s.statsRow}>
                <StatCard label="Remaining" value={fmt(remaining)} accent={remaining >= 0 ? "#10b981" : "#ef4444"} sub="After everything this month" icon="↓" />
                <StatCard label="Still to Pay" value={fmt(totalUpcoming)} accent="#f59e0b" sub={`${unpaidCount} upcoming payment${unpaidCount !== 1 ? "s" : ""}`} icon="◈" />
                <StatCard label="Can Invest" value={fmt(canInvest)} accent="#0066ff" sub={`After ${displayPct}% savings goal`} icon="↗" />
                <StatCard label="Total Spent" value={fmt(totalExpenses + totalRecurring)} accent="#ef4444" sub={`${cur.expenses.length} one-off · ${cur.recurring.length} recurring`} icon="↻" />
              </div>
              {/* Savings goal + income breakdown strip */}
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 32, alignItems: "start" }}>
                  <div>
                    <div style={s.cardTitle}>Savings Goal</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 12 }}>
                      <input type="range" min={0} max={maxSavingsPct} value={displayPct}
                        onChange={(e) => save({ ...data, savingsGoalPercent: +e.target.value })}
                        style={{ flex: 1, accentColor: "#0066ff" }} />
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#0066ff", fontSize: 18, minWidth: 100, textAlign: "right" }}>
                        {displayPct}%
                        <div style={{ fontSize: 12, color: theme.textMuted, fontWeight: 400 }}>{fmt(savingsTarget)}</div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div style={s.cardTitle}>Income Breakdown</div>
                    {effectiveIncome > 0 ? (
                      <>
                        <div style={s.breakdownBar}>
                          {[
                            { pct: ((totalExpenses + totalRecurring) / effectiveIncome) * 100, color: "#ef4444" },
                            { pct: (totalUpcoming / effectiveIncome) * 100, color: "#f59e0b" },
                            { pct: (savingsTarget / effectiveIncome) * 100, color: "#0066ff" },
                            { pct: (canInvest / effectiveIncome) * 100, color: "#10b981" },
                          ].filter((x) => x.pct > 0 && isFinite(x.pct)).map((seg, i) => (
                            <div key={i} style={{ height: "100%", background: seg.color, width: `${Math.min(seg.pct, 100)}%`, transition: "width .3s" }} />
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 20, marginTop: 10, flexWrap: "wrap" }}>
                          {[
                            { color: "#ef4444", label: "Spent", val: totalExpenses + totalRecurring },
                            { color: "#f59e0b", label: "Upcoming", val: totalUpcoming },
                            { color: "#0066ff", label: "Savings", val: savingsTarget },
                            { color: "#10b981", label: "Investable", val: canInvest },
                          ].map((l) => (
                            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                              <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
                              <span style={{ color: theme.textFaint }}>{l.label}</span>
                              <span style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: theme.text }}>{fmt(l.val)}</span>
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
                  <div style={s.cardTitle}>Category Budgets</div>
                  <div style={{ marginTop: 12 }}>
                    <CategoryBudgets
                      categories={data.categories}
                      spent={spentByCat}
                      average={(name) => categoryAverage(data, name, curKey)}
                      onSetCap={onSetCap}
                    />
                  </div>
                </div>
                <div style={s.card}>
                  <div style={s.cardTitle}>By Category</div>
                  <CategoryDonut data={catBreakdown} total={catTotal} />
                </div>
              </div>

              {/* Charts row 2: monthly bars */}
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={s.cardTitle}>Monthly Totals</div>
                <MonthlyBarChart
                  data={monthlyData}
                  curKey={curKey}
                  onBarClick={(key) => { setTab("history"); setHistoryKey(key); }}
                />
              </div>

              {/* Recent expenses + upcoming payments */}
              <div style={{ display: "grid", gridTemplateColumns: totalCredits > 0 ? "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
                <div style={s.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Recent Expenses</div>
                    <button style={s.linkBtn} onClick={() => setTab("expenses")}>View all →</button>
                  </div>
                  {cur.expenses.length === 0 ? (
                    <div style={s.emptySmall}>No expenses logged</div>
                  ) : cur.expenses.slice(-4).reverse().map((e) => (
                    <div key={e.id} style={s.miniRow}>
                      <div><div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div><div style={{ fontSize: 11, color: theme.textMuted }}>{e.date}</div></div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444", fontSize: 13 }}>{fmt(e.amount)}</div>
                    </div>
                  ))}
                </div>
                <div style={s.card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={s.cardTitle}>Upcoming Payments</div>
                    <button style={s.linkBtn} onClick={() => setTab("upcoming")}>View all →</button>
                  </div>
                  {cur.upcoming.filter((u) => !u.paid).length === 0 ? (
                    <div style={s.emptySmall}>All caught up!</div>
                  ) : cur.upcoming.filter((u) => !u.paid).slice(0, 4).map((u) => (
                    <div key={u.id} style={s.miniRow}>
                      <div><div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div><div style={{ fontSize: 11, color: theme.textMuted }}>Due {u.dueDate}</div></div>
                      <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#f59e0b", fontSize: 13 }}>{fmt(u.amount)}</div>
                    </div>
                  ))}
                </div>
                {totalCredits > 0 && (
                  <div style={s.card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={s.cardTitle}>Recent Credits</div>
                      <button style={s.linkBtn} onClick={() => setTab("credits")}>View all →</button>
                    </div>
                    {[...cur.credits].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 4).map((c) => (
                      <div key={c.id} style={s.miniRow}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: theme.textMuted }}>{c.source} · {c.date}</div>
                        </div>
                        <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#10b981", fontSize: 13 }}>+{fmt(c.amount)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* EXPENSES */}
          {tab === "expenses" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>All Expenses</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444", fontSize: 16 }}>Total: {fmt(totalExpenses)}</div>
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
                  <TableHeader columns={[{ label: "NAME", flex: 2, sortKey: "name" }, { label: "CATEGORY", flex: 1.2, sortKey: "category" }, { label: "DATE", flex: 1, sortKey: "date" }, { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" }, { label: "", flex: 0.6, align: "center" }]} sortCol={expensesView.sortCol} sortDir={expensesView.sortDir} onSort={onSortExpenses} />
                  {filteredExpenses.map((e) => (
                    <div key={e.id} style={s.tableRow}>
                      <div style={{ flex: 2, fontWeight: 600 }}>{e.name}</div>
                      <div style={{ flex: 1.2 }}><CategoryPill categoryName={e.category} categories={data.categories} /></div>
                      <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{e.date}</div>
                      <div style={{ flex: 1, textAlign: "right", fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444" }}>{fmt(e.amount)}</div>
                      <div style={{ flex: 0.6, textAlign: "center", display: "flex", justifyContent: "center", gap: 4 }}>
                        <button style={s.editBtn} onClick={() => setModal({ type: "expense", editId: e.id })}>✎</button>
                        <button
                          style={{
                            ...s.delBtn,
                            color: pendingDelete === e.id ? "#ef4444" : theme.textFaint,
                            fontWeight: pendingDelete === e.id ? 700 : 400,
                          }}
                          onClick={() => {
                            if (pendingDelete === e.id) {
                              patchCur({ expenses: cur.expenses.filter((x) => x.id !== e.id) });
                              setPendingDelete(null);
                            } else {
                              setPendingDelete(e.id);
                            }
                          }}
                        >✕</button>
                      </div>
                    </div>
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
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#0066ff", fontSize: 16 }}>Monthly: {fmt(totalRecurring)}</div>
              </div>
              <input
                type="text"
                placeholder="Search recurring..."
                value={recurringView.search}
                onChange={(e) => setRecurringView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredRecurring.length === 0 ? <div style={s.empty}>{recurringView.search ? `No recurring items match "${recurringView.search}".` : `No recurring payments set up. Click "+ Add Recurring" to create one.`}</div> : (
                <>
                  <TableHeader columns={[{ label: "NAME", flex: 2, sortKey: "name" }, { label: "CATEGORY", flex: 1.2, sortKey: "category" }, { label: "FREQUENCY", flex: 1 }, { label: "DAY", flex: 0.5, align: "center", sortKey: "dayOfMonth" }, { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" }, { label: "", flex: 0.6, align: "center" }]} sortCol={recurringView.sortCol} sortDir={recurringView.sortDir} onSort={onSortRecurring} />
                  {filteredRecurring.map((r) => (
                    <div key={r.id} style={s.tableRow}>
                      <div style={{ flex: 2, fontWeight: 600 }}>{r.name}</div>
                      <div style={{ flex: 1.2 }}><CategoryPill categoryName={r.category} categories={data.categories} /></div>
                      <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{r.frequency}</div>
                      <div style={{ flex: 0.5, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>{r.dayOfMonth || "—"}</div>
                      <div style={{ flex: 1, textAlign: "right", fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#0066ff" }}>{fmt(r.amount)}</div>
                      <div style={{ flex: 0.6, textAlign: "center", display: "flex", justifyContent: "center", gap: 4 }}>
                        <button style={s.editBtn} onClick={() => setModal({ type: "recurring", editId: r.id })}>✎</button>
                        <button
                          style={{
                            ...s.delBtn,
                            color: pendingDelete === r.id ? "#ef4444" : theme.textFaint,
                            fontWeight: pendingDelete === r.id ? 700 : 400,
                          }}
                          onClick={() => {
                            if (pendingDelete === r.id) {
                              save({
                                ...data,
                                months: { ...data.months, [curKey]: { ...cur, recurring: cur.recurring.filter((x) => x.id !== r.id) } },
                                recurringTemplate: data.recurringTemplate.filter((x) => !(x.name === r.name && x.amount === r.amount)),
                              });
                              setPendingDelete(null);
                            } else {
                              setPendingDelete(r.id);
                            }
                          }}
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* UPCOMING */}
          {tab === "upcoming" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>Upcoming Payments</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#f59e0b", fontSize: 16 }}>Owed: {fmt(totalUpcoming)}</div>
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
                  <TableHeader columns={[{ label: "", flex: 0.3 }, { label: "NAME", flex: 2, sortKey: "name" }, { label: "CATEGORY", flex: 1.2, sortKey: "category" }, { label: "DUE DATE", flex: 1, sortKey: "dueDate" }, { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" }, { label: "STATUS", flex: 0.7, align: "center" }, { label: "", flex: 0.6, align: "center" }]} sortCol={upcomingView.sortCol} sortDir={upcomingView.sortDir} onSort={onSortUpcoming} />
                  {filteredUpcoming.map((u) => (
                    <div key={u.id} style={{ ...s.tableRow, opacity: u.paid ? 0.4 : 1 }}>
                      <div style={{ flex: 0.3 }}>
                        <input type="checkbox" checked={!!u.paid}
                          onChange={() => patchCur({ upcoming: cur.upcoming.map((x) => x.id === u.id ? { ...x, paid: !x.paid } : x) })}
                          style={{ accentColor: "#10b981", width: 16, height: 16, cursor: "pointer" }} />
                      </div>
                      <div style={{ flex: 2, fontWeight: 600, textDecoration: u.paid ? "line-through" : "none" }}>{u.name}</div>
                      <div style={{ flex: 1.2 }}><CategoryPill categoryName={u.category} categories={data.categories} /></div>
                      <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{u.dueDate}</div>
                      <div style={{ flex: 1, textAlign: "right", fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: u.paid ? "#10b981" : "#f59e0b" }}>{fmt(u.amount)}</div>
                      <div style={{ flex: 0.7, textAlign: "center" }}>
                        <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600,
                          background: u.paid ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                          color: u.paid ? "#10b981" : "#f59e0b"
                        }}>{u.paid ? "Paid" : "Pending"}</span>
                      </div>
                      <div style={{ flex: 0.6, textAlign: "center", display: "flex", justifyContent: "center", gap: 4 }}>
                        <button style={s.editBtn} onClick={() => setModal({ type: "upcoming", editId: u.id })}>✎</button>
                        <button
                          style={{
                            ...s.delBtn,
                            color: pendingDelete === u.id ? "#ef4444" : theme.textFaint,
                            fontWeight: pendingDelete === u.id ? 700 : 400,
                          }}
                          onClick={() => {
                            if (pendingDelete === u.id) {
                              patchCur({ upcoming: cur.upcoming.filter((x) => x.id !== u.id) });
                              setPendingDelete(null);
                            } else {
                              setPendingDelete(u.id);
                            }
                          }}
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* CREDITS */}
          {tab === "credits" && (
            <div style={s.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={s.cardTitle}>Credits</div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#10b981", fontSize: 16 }}>Total: {fmt(totalCredits)}</div>
              </div>
              <input
                type="text"
                placeholder="Search credits..."
                value={creditsView.search}
                onChange={(e) => setCreditsView((v) => ({ ...v, search: e.target.value }))}
                style={s.searchInput}
              />
              {filteredCredits.length === 0 ? (
                <div style={s.empty}>{creditsView.search ? `No credits match "${creditsView.search}".` : `No credits this month. Use "+ Add Credit" to log a refund, gift, or bonus.`}</div>
              ) : (
                <>
                  <TableHeader columns={[{ label: "NAME", flex: 2, sortKey: "name" }, { label: "SOURCE", flex: 1.2, sortKey: "source" }, { label: "DATE", flex: 1, sortKey: "date" }, { label: "AMOUNT", flex: 1, align: "right", sortKey: "amount" }, { label: "", flex: 0.6, align: "center" }]} sortCol={creditsView.sortCol} sortDir={creditsView.sortDir} onSort={onSortCredits} />
                  {filteredCredits.map((c) => (
                    <div key={c.id} style={s.tableRow}>
                      <div style={{ flex: 2, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ flex: 1.2, color: theme.textMuted, fontSize: 13 }}>{c.source || "Other"}</div>
                      <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{c.date}</div>
                      <div style={{ flex: 1, textAlign: "right", fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#10b981" }}>+{fmt(c.amount)}</div>
                      <div style={{ flex: 0.6, textAlign: "center", display: "flex", justifyContent: "center", gap: 4 }}>
                        <button style={s.editBtn} onClick={() => setModal({ type: "credit", editId: c.id })}>✎</button>
                        <button
                          style={{
                            ...s.delBtn,
                            color: pendingDelete === c.id ? "#ef4444" : theme.textFaint,
                            fontWeight: pendingDelete === c.id ? 700 : 400,
                          }}
                          onClick={() => {
                            if (pendingDelete === c.id) {
                              patchCur({ credits: cur.credits.filter((x) => x.id !== c.id) });
                              setPendingDelete(null);
                            } else {
                              setPendingDelete(c.id);
                            }
                          }}
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

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
                      const credits = (m.credits || []).reduce((a, c) => a + c.amount, 0);
                      const spent = m.expenses.reduce((a, e) => a + e.amount, 0) + m.recurring.reduce((a, e) => a + e.amount, 0);
                      const effective = m.income + credits;
                      const rem = effective - spent;
                      const color = rem >= 0 ? "#10b981" : "#ef4444";
                      return (
                        <button key={k} onClick={() => setHistoryKey(k)} style={{
                          background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20,
                          textAlign: "left", cursor: "pointer", display: "grid",
                          gridTemplateColumns: "1.5fr 1fr 1fr 1fr 8px", gap: 16, alignItems: "center",
                          color: theme.text, fontFamily: "'DM Sans', sans-serif",
                        }}>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{monthLabel(k)}</div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Income</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(m.income)}</div>
                            {credits > 0 && (
                              <div style={{ fontSize: 10, color: "#10b981", fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums" }}>+{fmt(credits)}</div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Spent</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444" }}>{fmt(spent)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Remaining</div>
                            <div style={{ fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color }}>{fmt(rem)}</div>
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
            const spent = m.expenses.reduce((a, e) => a + e.amount, 0);
            const rec = m.recurring.reduce((a, e) => a + e.amount, 0);
            const upc = m.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
            const credits = (m.credits || []).reduce((a, c) => a + c.amount, 0);
            const effective = m.income + credits;
            const committed = spent + rec + upc;
            const sTargetRaw = (m.income * data.savingsGoalPercent) / 100;
            const availableH = Math.max(0, effective - committed);
            const sTarget = Math.min(sTargetRaw, availableH);
            const canInv = Math.max(0, availableH - sTarget);
            const rem = effective - spent - rec;
            return (
              <>
                <button style={{ ...s.linkBtn, marginBottom: 16, fontSize: 14 }} onClick={() => setHistoryKey(null)}>← Back to History</button>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 16px" }}>{monthLabel(historyKey)}</h2>
                <div style={s.statsRow}>
                  <StatCard label="Income" value={fmt(effective)} accent="#10b981" sub={credits > 0 ? `+${fmt(credits)} credits` : "For this month"} icon="↑" />
                  <StatCard label="Remaining" value={fmt(rem)} accent={rem >= 0 ? "#10b981" : "#ef4444"} sub="After expenses & recurring" icon="↓" />
                  <StatCard label="Total Spent" value={fmt(spent + rec)} accent="#ef4444" sub={`${m.expenses.length} one-off · ${m.recurring.length} recurring`} icon="↻" />
                  <StatCard label="Can Invest" value={fmt(canInv)} accent="#0066ff" sub={`After ${data.savingsGoalPercent}% savings goal`} icon="↗" />
                </div>
                <div style={s.card}>
                  <div style={s.cardTitle}>Expenses</div>
                  {m.expenses.length === 0 ? <div style={s.emptySmall}>No expenses</div> : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "CATEGORY", flex: 1.2 }, { label: "DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }]} />
                      {m.expenses.map((e) => (
                        <div key={e.id} style={s.tableRow}>
                          <div style={{ flex: 2, fontWeight: 600 }}>{e.name}</div>
                          <div style={{ flex: 1.2 }}><CategoryPill categoryName={e.category} categories={data.categories} /></div>
                          <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{e.date}</div>
                          <div style={{ flex: 1, textAlign: "right", fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#ef4444" }}>{fmt(e.amount)}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={s.cardTitle}>Recurring</div>
                  {m.recurring.length === 0 ? <div style={s.emptySmall}>No recurring</div> : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "CATEGORY", flex: 1.2 }, { label: "FREQUENCY", flex: 1 }, { label: "DAY", flex: 0.5, align: "center" }, { label: "AMOUNT", flex: 1, align: "right" }]} />
                      {m.recurring.map((r) => (
                        <div key={r.id} style={s.tableRow}>
                          <div style={{ flex: 2, fontWeight: 600 }}>{r.name}</div>
                          <div style={{ flex: 1.2 }}><CategoryPill categoryName={r.category} categories={data.categories} /></div>
                          <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{r.frequency}</div>
                          <div style={{ flex: 0.5, textAlign: "center", color: theme.textMuted, fontSize: 13 }}>{r.dayOfMonth || "—"}</div>
                          <div style={{ flex: 1, textAlign: "right", fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#0066ff" }}>{fmt(r.amount)}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                <div style={{ ...s.card, marginTop: 16 }}>
                  <div style={s.cardTitle}>Upcoming</div>
                  {m.upcoming.length === 0 ? <div style={s.emptySmall}>No upcoming</div> : (
                    <>
                      <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "CATEGORY", flex: 1.2 }, { label: "DUE DATE", flex: 1 }, { label: "PAID", flex: 0.7, align: "center" }, { label: "AMOUNT", flex: 1, align: "right" }]} />
                      {m.upcoming.map((u) => (
                        <div key={u.id} style={{ ...s.tableRow, opacity: u.paid ? 0.4 : 1 }}>
                          <div style={{ flex: 2, fontWeight: 600 }}>{u.name}</div>
                          <div style={{ flex: 1.2 }}><CategoryPill categoryName={u.category} categories={data.categories} /></div>
                          <div style={{ flex: 1, color: theme.textMuted, fontSize: 13 }}>{u.dueDate}</div>
                          <div style={{ flex: 0.7, textAlign: "center", color: u.paid ? "#10b981" : theme.textMuted, fontSize: 13 }}>{u.paid ? "Yes" : "No"}</div>
                          <div style={{ flex: 1, textAlign: "right", fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: u.paid ? "#10b981" : "#f59e0b" }}>{fmt(u.amount)}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </>
            );
          })()}
          {tab === "year" && (() => {
            const allYears = Array.from(new Set(Object.keys(data.months).map((k) => k.slice(0, 4)))).sort();
            const monthsInYear = Object.entries(data.months)
              .filter(([k]) => k.startsWith(yearKey + "-"))
              .map(([, m]) => m);

            const totalIncomeY = monthsInYear.reduce((a, m) => {
              const cr = (m.credits || []).reduce((aa, c) => aa + c.amount, 0);
              return a + (m.income || 0) + cr;
            }, 0);
            const totalSpentY = monthsInYear.reduce((a, m) => {
              const exp = (m.expenses || []).reduce((aa, e) => aa + e.amount, 0);
              const rec = (m.recurring || []).reduce((aa, r) => aa + r.amount, 0);
              return a + exp + rec;
            }, 0);
            const totalSavedY = totalIncomeY - totalSpentY;
            const monthsCount = monthsInYear.length;
            const avgMonthlySpend = monthsCount > 0 ? totalSpentY / monthsCount : 0;

            const yearCatTotals = new Map();
            for (const m of monthsInYear) {
              for (const e of (m.expenses || [])) yearCatTotals.set(e.category, (yearCatTotals.get(e.category) || 0) + e.amount);
              for (const r of (m.recurring || [])) yearCatTotals.set(r.category, (yearCatTotals.get(r.category) || 0) + r.amount);
            }
            const yearCatBreakdown = Array.from(yearCatTotals.entries()).map(([name, value]) => {
              const cat = (data.categories || []).find((c) => c.name === name) || { color: "#9ca3af", icon: "·" };
              return { name, value, color: cat.color, icon: cat.icon };
            }).sort((a, b) => b.value - a.value);
            const yearCatTotal = yearCatBreakdown.reduce((a, c) => a + c.value, 0);

            const prevYear = String(Number(yearKey) - 1);
            const nextYear = String(Number(yearKey) + 1);
            const canPrev = allYears.includes(prevYear);
            const canNext = allYears.includes(nextYear);

            return (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 16 }}>
                  <button style={{ ...s.linkBtn, opacity: canPrev ? 1 : 0.3, cursor: canPrev ? "pointer" : "default" }}
                    disabled={!canPrev} onClick={() => setYearKey(prevYear)}>← {prevYear}</button>
                  <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{yearKey}</h2>
                  <button style={{ ...s.linkBtn, opacity: canNext ? 1 : 0.3, cursor: canNext ? "pointer" : "default" }}
                    disabled={!canNext} onClick={() => setYearKey(nextYear)}>{nextYear} →</button>
                </div>
                {monthsCount === 0 ? (
                  <div style={s.empty}>No data for {yearKey}.</div>
                ) : (
                  <>
                    <div style={s.statsRow}>
                      <StatCard label="Total Income" value={fmt(totalIncomeY)} accent="#10b981"
                        sub={`${monthsCount} month${monthsCount !== 1 ? "s" : ""} tracked`} icon="↑" />
                      <StatCard label="Total Spent" value={fmt(totalSpentY)} accent="#ef4444"
                        sub="Across the year" icon="↻" />
                      <StatCard label="Total Saved" value={fmt(totalSavedY)}
                        accent={totalSavedY >= 0 ? "#10b981" : "#ef4444"}
                        sub={totalSavedY >= 0 ? "Income minus spent" : "Overspent"} icon="↓" />
                      <StatCard label="Avg Monthly" value={fmt(avgMonthlySpend)} accent="#0066ff"
                        sub="Spending per month" icon="◐" />
                    </div>
                    <div style={{ ...s.card, marginTop: 16 }}>
                      <div style={s.cardTitle}>Category Breakdown — {yearKey}</div>
                      <CategoryDonut data={yearCatBreakdown} total={yearCatTotal} />
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </div>
        </div>
      </main>

      {/* MODALS */}
      {modal?.type === "expense" && (() => {
        const editing = modal.editId ? cur.expenses.find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Expense" : "Add Expense"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Groceries", defaultValue: editing?.name },
            { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "date", label: "Date", type: "date", defaultValue: editing?.date || new Date().toISOString().slice(0, 10) },
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const { categories, category } = ensureCategory(data.categories, v.category);
            if (editing) {
              save({
                ...data,
                categories,
                months: {
                  ...data.months,
                  [curKey]: {
                    ...cur,
                    expenses: cur.expenses.map((x) => x.id === editing.id
                      ? { ...x, name: v.name, amount: +v.amount, date: v.date, category: category.name }
                      : x),
                  },
                },
              });
            } else {
              const newExp = { id: uid(), name: v.name, amount: +v.amount, date: v.date, category: category.name };
              save({
                ...data,
                categories,
                months: { ...data.months, [curKey]: { ...cur, expenses: [...cur.expenses, newExp] } },
              });
            }
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "recurring" && (() => {
        const editing = modal.editId ? cur.recurring.find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Recurring Payment" : "Add Recurring Payment"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Rent", defaultValue: editing?.name },
            { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "frequency", label: "Frequency", type: "select", options: ["Monthly", "Weekly", "Yearly"], defaultValue: editing?.frequency },
            { key: "dayOfMonth", label: "Day of Month", type: "number", placeholder: "1", defaultValue: editing ? String(editing.dayOfMonth) : "" },
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const { categories, category } = ensureCategory(data.categories, v.category);
            if (editing) {
              const updatedItem = {
                ...editing,
                name: v.name,
                amount: +v.amount,
                frequency: v.frequency || "Monthly",
                dayOfMonth: +v.dayOfMonth || 1,
                category: category.name,
              };
              save({
                ...data,
                categories,
                months: {
                  ...data.months,
                  [curKey]: {
                    ...cur,
                    recurring: cur.recurring.map((x) => x.id === editing.id ? updatedItem : x),
                  },
                },
                recurringTemplate: data.recurringTemplate.map((t) =>
                  (t.name === editing.name && t.amount === editing.amount)
                    ? { ...t, name: v.name, amount: +v.amount, frequency: v.frequency || "Monthly", dayOfMonth: +v.dayOfMonth || 1, category: category.name }
                    : t
                ),
              });
            } else {
              const newItem = { id: uid(), name: v.name, amount: +v.amount, frequency: v.frequency || "Monthly", dayOfMonth: +v.dayOfMonth || 1, category: category.name };
              save({
                ...data,
                categories,
                months: { ...data.months, [curKey]: { ...cur, recurring: [...cur.recurring, newItem] } },
                recurringTemplate: [...data.recurringTemplate, { ...newItem }],
              });
            }
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "upcoming" && (() => {
        const editing = modal.editId ? cur.upcoming.find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Upcoming Payment" : "Add Upcoming Payment"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Car Insurance", defaultValue: editing?.name },
            { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "category", label: "Category", type: "category", categories: data.categories, defaultValue: editing?.category },
            { key: "dueDate", label: "Due Date", type: "date", defaultValue: editing?.dueDate || new Date().toISOString().slice(0, 10) },
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const { categories, category } = ensureCategory(data.categories, v.category);
            if (editing) {
              save({
                ...data,
                categories,
                months: {
                  ...data.months,
                  [curKey]: {
                    ...cur,
                    upcoming: cur.upcoming.map((x) => x.id === editing.id
                      ? { ...x, name: v.name, amount: +v.amount, dueDate: v.dueDate, category: category.name }
                      : x),
                  },
                },
              });
            } else {
              const newItem = { id: uid(), name: v.name, amount: +v.amount, dueDate: v.dueDate, paid: false, category: category.name };
              save({
                ...data,
                categories,
                months: { ...data.months, [curKey]: { ...cur, upcoming: [...cur.upcoming, newItem] } },
              });
            }
            setModal(null);
          }} />
        );
      })()}
      {modal?.type === "credit" && (() => {
        const editing = modal.editId ? cur.credits.find((x) => x.id === modal.editId) : null;
        return (
          <FormModal title={editing ? "Edit Credit" : "Add Credit"} fields={[
            { key: "name", label: "Name", placeholder: "e.g. Amazon refund", defaultValue: editing?.name },
            { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0", defaultValue: editing ? String(editing.amount) : "" },
            { key: "source", label: "Source", placeholder: "Refund, Gift, Bonus, Other", defaultValue: editing?.source },
            { key: "date", label: "Date", type: "date", defaultValue: editing?.date || new Date().toISOString().slice(0, 10) },
          ]} onClose={() => setModal(null)} onSave={(v) => {
            const amt = +v.amount;
            if (!v.name || !(amt > 0)) { setModal(null); return; }
            if (editing) {
              patchCur({
                credits: cur.credits.map((x) => x.id === editing.id
                  ? { ...x, name: v.name, amount: amt, date: v.date, source: (v.source || "Other").trim() || "Other" }
                  : x),
              });
            } else {
              const newCredit = { id: uid(), name: v.name, amount: amt, date: v.date, source: (v.source || "Other").trim() || "Other" };
              patchCur({ credits: [...(cur.credits || []), newCredit] });
            }
            setModal(null);
          }} />
        );
      })()}
    </div>
    </ThemeContext.Provider>
  );
}

function makeStyles(theme) {
  return {
    shell: { display: "flex", height: "100vh", background: theme.outerBg, color: theme.text, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" },
    sidebar: { width: 240, minWidth: 240, background: theme.outerBg, borderRight: "none", display: "flex", flexDirection: "column", height: "100vh" },
    logo: { padding: "28px 24px 24px", borderBottom: `1px solid ${theme.border}` },
    nav: { padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4, flex: 1 },
    navItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: "none", background: "transparent", color: theme.outerTextMuted, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", textAlign: "left", width: "100%" },
    navItemActive: { background: theme.outerAccentSoft, color: "#ffffff" },
    badge: { background: theme.warning, color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 999, padding: "1px 7px", marginLeft: "auto" },
    sidebarIncome: { padding: "16px 20px", borderTop: "1px solid " + theme.outerBorder },
    incomeInput: { background: theme.outerBorder, border: "1px solid " + theme.outerBorder, borderRadius: 10, padding: "10px 12px", color: theme.success, fontFamily: "'DM Sans', sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 16, width: "100%", textAlign: "right", outline: "none", boxSizing: "border-box" },
    main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: theme.outerBg },
    topbar: { padding: "24px 36px 20px", borderBottom: "none", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, background: theme.outerBg },
    content: { flex: 1, overflow: "auto", background: theme.bg, borderRadius: 20, margin: "0 16px 16px 0", padding: 32 },
    contentInner: { maxWidth: 1400, margin: "0 auto" },
    statsRow: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 24 },
    statCard: { background: theme.surface, borderRadius: 16, padding: 20, border: `1px solid ${theme.border}`, boxShadow: theme.shadowCard },
    dashGrid: { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16 },
    card: { background: theme.surface, borderRadius: 16, padding: 24, border: `1px solid ${theme.border}`, boxShadow: theme.shadowCard },
    cardTitle: { fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2, color: theme.textMuted, fontWeight: 700 },
    linkBtn: { background: "none", border: "none", color: theme.accent, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600 },
    searchInput: { width: "100%", background: "transparent", border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 12px", fontSize: 13, color: theme.text, outline: "none", marginBottom: 12, fontFamily: "'DM Sans', sans-serif" },
    dataLink: { background: "none", border: "none", color: theme.outerTextMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, padding: "6px 0", textAlign: "left" },
    breakdownBar: { display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: theme.bg, marginTop: 12 },
    tableHeader: { display: "flex", padding: "12px 16px", borderBottom: `1px solid ${theme.border}`, marginTop: 16, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: theme.textFaint, fontWeight: 700 },
    tableRow: { display: "flex", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${theme.border}`, fontSize: 14 },
    miniRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${theme.border}` },
    addBtn: { background: theme.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
    themeToggle: { background: "transparent", border: "none", color: "#ffffff", fontSize: 18, cursor: "pointer", padding: "6px 10px", marginRight: 8 },
    delBtn: { background: "none", border: "none", color: theme.textFaint, cursor: "pointer", fontSize: 14, padding: "4px 8px" },
    editBtn: { background: "none", border: "none", color: theme.textMuted, cursor: "pointer", fontSize: 14, padding: "4px 8px" },
    empty: { textAlign: "center", color: theme.textFaint, padding: "60px 20px", fontSize: 14 },
    emptySmall: { textAlign: "center", color: theme.textFaint, padding: "24px 0", fontSize: 13 },
    overlay: { position: "fixed", inset: 0, background: "rgba(12,13,18,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
    modal: { background: theme.surface, borderRadius: 16, padding: 28, width: "100%", maxWidth: 460, border: `1px solid ${theme.border}`, boxShadow: "0 20px 40px rgba(0,0,0,0.12)" },
    modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    closeBtn: { background: "none", border: "none", color: theme.textFaint, fontSize: 20, cursor: "pointer" },
    input: { width: "100%", background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "11px 14px", color: theme.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" },
    saveBtn: { width: "100%", background: theme.accent, color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 700, fontSize: 14, cursor: "pointer", marginTop: 8, fontFamily: "'DM Sans', sans-serif" },
    catPill: { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 4px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
    catDot: { width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 },
    suggestBox: { position: "absolute", top: "100%", left: 0, right: 0, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10, boxShadow: theme.shadowCard, zIndex: 10, maxHeight: 200, overflow: "auto", marginTop: 4 },
    suggestItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", fontSize: 14 },
    chartEmpty: { textAlign: "center", color: theme.textFaint, padding: "80px 20px", fontSize: 13 },
    chartTooltip: { background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: theme.text, boxShadow: theme.shadowCard },
  };
}

const s = makeStyles(THEME_LIGHT_PANEL);

const ThemeContext = createContext({ theme: THEME_LIGHT_PANEL, s });
const useThemed = () => useContext(ThemeContext);