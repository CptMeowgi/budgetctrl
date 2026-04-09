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
import { useState, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from "recharts";

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

function variableDaily(month, key, baseIncome, credits, savingsPct) {
  const [year, mon] = key.split("-").map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();

  const fixed = (month.recurring || []).reduce((a, r) => a + r.amount, 0)
              + (month.upcoming  || []).reduce((a, u) => a + u.amount, 0);
  const effective = baseIncome + credits;
  const savingsTargetRaw = (baseIncome * (savingsPct || 0)) / 100;
  const afterFixed = Math.max(0, effective - fixed);
  const savings = Math.min(savingsTargetRaw, afterFixed);
  const variableBudget = Math.max(0, afterFixed - savings);

  const out = [];
  let running = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    for (const e of (month.expenses || [])) {
      const d = Number((e.date || "").slice(8, 10));
      if (d === day) running += e.amount;
    }
    out.push({ day, actual: running, pace: (variableBudget / daysInMonth) * day });
  }

  const today = new Date();
  const curKeyNow = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const isCurrentMonth = key === curKeyNow;
  const todayDay = isCurrentMonth ? Math.min(today.getDate(), daysInMonth) : 0;
  const actualToday = todayDay > 0 ? out[todayDay - 1].actual : 0;
  const projectedVariable = todayDay >= 5
    ? (actualToday / todayDay) * daysInMonth
    : null;

  if (projectedVariable != null) {
    for (let i = 0; i < out.length; i++) {
      const day = i + 1;
      if (day < todayDay) {
        out[i].projected = null;
      } else if (day === todayDay) {
        out[i].projected = actualToday;
      } else {
        const t = (day - todayDay) / (daysInMonth - todayDay);
        out[i].projected = actualToday + (projectedVariable - actualToday) * t;
      }
    }
  }

  return { data: out, variableBudget, fixed, todayDay, actualToday, projectedVariable };
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
            <label style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, display: "block", fontWeight: 600 }}>{f.label}</label>
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
  return (
    <div style={{ ...s.statCard, borderTop: `3px solid ${accent}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1.5, color: "#6b7280", fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 20, opacity: 0.3 }}>{icon}</div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent, fontFamily: "'JetBrains Mono', monospace", margin: "8px 0 4px" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#6b7280" }}>{sub}</div>}
    </div>
  );
}

function TableHeader({ columns }) {
  return (
    <div style={s.tableHeader}>
      {columns.map((c, i) => (
        <div key={i} style={{ flex: c.flex || 1, textAlign: c.align || "left" }}>{c.label}</div>
      ))}
    </div>
  );
}

function CategoryPill({ categoryName, categories }) {
  const cat = findCategory(categories, categoryName) || UNCATEGORIZED;
  return (
    <span style={{ ...s.catPill, background: `${cat.color}15`, color: cat.color }}>
      <span style={{ ...s.catDot, background: `${cat.color}25` }}>{cat.icon}</span>
      {cat.name}
    </span>
  );
}

function CategoryDonut({ data, total }) {
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
                <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>{fmt(d.value)} · {pct}%</div>
              </div>
            );
          }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 11, color: THEME.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Total</div>
        <div style={{ fontSize: 18, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: THEME.text }}>{fmt(total)}</div>
      </div>
    </div>
  );
}

function VariableSpendChart({ data, variableBudget, fixed, todayDay, projectedVariable }) {
  if (!data.length) {
    return <div style={s.chartEmpty}>No variable spending yet this month.</div>;
  }
  const allZero = data.every((d) => d.actual === 0);
  return (
    <div style={{ width: "100%", height: 240, position: "relative" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <CartesianGrid stroke={THEME.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" stroke={THEME.textFaint} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={THEME.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const actual = payload.find((p) => p.dataKey === "actual")?.value ?? 0;
            const pace = payload.find((p) => p.dataKey === "pace")?.value ?? 0;
            const projected = payload.find((p) => p.dataKey === "projected")?.value;
            const delta = actual - pace;
            const deltaLabel = delta >= 0 ? "Over" : "Under";
            const deltaColor = delta >= 0 ? THEME.danger : THEME.success;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Day {label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.accent }}>Spent: {fmt(actual)}</div>
                {variableBudget > 0 && (
                  <>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.textMuted }}>Pace: {fmt(pace)}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", color: deltaColor }}>{deltaLabel}: {fmt(Math.abs(delta))}</div>
                    {projected != null && (
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.warning }}>Projected: {fmt(projected)}</div>
                    )}
                  </>
                )}
              </div>
            );
          }} />
          {variableBudget > 0 && (
            <Line type="monotone" dataKey="pace" stroke={THEME.textFaint} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
          )}
          {projectedVariable != null && (
            <Line
              type="monotone"
              dataKey="projected"
              stroke={THEME.warning}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              connectNulls={false}
            />
          )}
          <Line type="monotone" dataKey="actual" stroke={THEME.accent} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      {variableBudget === 0 && (
        <div style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", fontSize: 12, color: THEME.warning, pointerEvents: "none" }}>
          Fixed costs ({fmt(fixed)}) consume your budget. No variable spend headroom.
        </div>
      )}
      {allZero && variableBudget > 0 && (
        <div style={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", fontSize: 12, color: THEME.textMuted, pointerEvents: "none" }}>
          No one-off spending yet this month.
        </div>
      )}
    </div>
  );
}

function MonthlyBarChart({ data, curKey, onBarClick }) {
  if (data.length < 2) {
    return <div style={s.chartEmpty}>Come back next month to see trends.</div>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
          <CartesianGrid stroke={THEME.border} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke={THEME.textFaint} fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke={THEME.textFaint} fontSize={11} tickLine={false} axisLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
          <RTooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div style={s.chartTooltip}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{d.key}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.danger }}>Spent: {fmt(d.spent)}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", color: THEME.textMuted }}>Income: {fmt(d.income)}</div>
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
                fill={d.spent > d.income ? THEME.danger : THEME.accent}
                style={{ cursor: d.key !== curKey ? "pointer" : "default" }}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(defaultData());
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [historyKey, setHistoryKey] = useState(null);

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
  const savingsTargetRaw = (baseIncome * data.savingsGoalPercent) / 100;
  const availableAfterCommitted = Math.max(0, effectiveIncome - totalCommitted);
  const savingsTarget = Math.min(savingsTargetRaw, availableAfterCommitted);
  const savingsShortfall = Math.max(0, savingsTargetRaw - savingsTarget);
  const canInvest = Math.max(0, availableAfterCommitted - savingsTarget);
  const remaining = effectiveIncome - totalCommitted;
  const unpaidCount = cur.upcoming.filter((u) => !u.paid).length;
  const totalUpcoming = totalUnpaidUpcoming;

  const catBreakdown = categoryBreakdown(cur, data.categories || []);
  const catTotal = catBreakdown.reduce((a, c) => a + c.value, 0);
  const dailyResult = variableDaily(cur, curKey, baseIncome, totalCredits, data.savingsGoalPercent);
  const dailyData = dailyResult.data;
  const variableBudget = dailyResult.variableBudget;
  const fixedTotal = dailyResult.fixed;
  const todayDay = dailyResult.todayDay;
  const projectedVariable = dailyResult.projectedVariable;
  const monthlyData = monthlyTotals(data);

  return (
    <div style={s.shell}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800&display=swap" rel="stylesheet" />

      {/* SIDEBAR */}
      <aside style={s.sidebar}>
        <div style={s.logo}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5, color: "#ffffff" }}>BUDGET</div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: THEME.accent, fontWeight: 700 }}>CTRL</div>
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
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1.5, color: THEME.outerTextMuted, marginBottom: 8, fontWeight: 600 }}>Monthly Income</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="number" value={cur.income || ""}
              onChange={(e) => patchCur({ income: +e.target.value || 0 })}
              placeholder="0" style={s.incomeInput} />
            <span style={{ fontSize: 12, color: THEME.outerTextMuted, fontWeight: 600 }}>PLN</span>
          </div>
          {totalCredits > 0 && (
            <div style={{ fontSize: 11, color: "#10b981", marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
              + {fmt(totalCredits)} credits
            </div>
          )}
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid " + THEME.outerBorder }}>
          <div style={{ fontSize: 10, color: THEME.outerTextMuted, letterSpacing: 1, textAlign: "center", cursor: "pointer" }}
            onClick={async () => { if (confirm("Reset all data?")) await save(migrateCategories(ensureCurrentMonth(defaultData()))); }}>
            RESET DATA
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={s.main}>
        <header style={s.topbar}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: -0.5, color: "#ffffff" }}>
              {TABS.find((t) => t.id === tab)?.label}
            </h1>
            <div style={{ fontSize: 12, color: THEME.outerTextMuted, marginTop: 2 }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </div>
          </div>
          {tab !== "dashboard" && tab !== "history" && (
            <button style={s.addBtn} onClick={() => setModal({ type: tab === "expenses" ? "expense" : tab === "credits" ? "credit" : tab })}>
              + Add {tab === "expenses" ? "Expense" : tab === "recurring" ? "Recurring" : tab === "credits" ? "Credit" : "Payment"}
            </button>
          )}
        </header>

        <div style={s.content}>
          <div style={s.contentInner}>
          {/* DASHBOARD */}
          {tab === "dashboard" && (
            <>
              <div style={{ ...s.statsRow, gridTemplateColumns: projectedVariable != null ? "repeat(5, 1fr)" : "repeat(4, 1fr)" }}>
                <StatCard label="Remaining" value={fmt(remaining)} accent={remaining >= 0 ? "#10b981" : "#ef4444"} sub="After everything this month" icon="↓" />
                <StatCard label="Still to Pay" value={fmt(totalUpcoming)} accent="#f59e0b" sub={`${unpaidCount} upcoming payment${unpaidCount !== 1 ? "s" : ""}`} icon="◈" />
                <StatCard label="Can Invest" value={fmt(canInvest)} accent="#0066ff" sub={`After ${data.savingsGoalPercent}% savings goal`} icon="↗" />
                <StatCard label="Total Spent" value={fmt(totalExpenses + totalRecurring)} accent="#ef4444" sub={`${cur.expenses.length} one-off · ${cur.recurring.length} recurring`} icon="↻" />
                {projectedVariable != null && (() => {
                  const delta = projectedVariable - variableBudget;
                  const overBudget = delta > 0;
                  const noBudget = variableBudget === 0;
                  const accent = noBudget ? "#6b7280" : (overBudget ? "#ef4444" : "#10b981");
                  const sub = noBudget
                    ? "No variable budget"
                    : overBudget
                      ? `Over by ${fmt(delta)}`
                      : `Under by ${fmt(-delta)}`;
                  return (
                    <StatCard label="Projected" value={fmt(projectedVariable)} accent={accent} sub={sub} icon="↗" />
                  );
                })()}
              </div>
              {/* Savings goal + income breakdown strip */}
              <div style={{ ...s.card, marginBottom: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 32, alignItems: "start" }}>
                  <div>
                    <div style={s.cardTitle}>Savings Goal</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 12 }}>
                      <input type="range" min={0} max={50} value={data.savingsGoalPercent}
                        onChange={(e) => save({ ...data, savingsGoalPercent: +e.target.value })}
                        style={{ flex: 1, accentColor: "#0066ff" }} />
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#0066ff", fontSize: 18, minWidth: 100, textAlign: "right" }}>
                        {data.savingsGoalPercent}%
                        <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 400 }}>{fmt(savingsTarget)}</div>
                        {savingsShortfall > 0 && (
                          <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 500, marginTop: 4 }}>
                            ⚠ Short by {fmt(savingsShortfall)}
                          </div>
                        )}
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
                              <span style={{ color: "#9ca3af" }}>{l.label}</span>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: "#0c0d12" }}>{fmt(l.val)}</span>
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
                  <div style={s.cardTitle}>Variable Spend</div>
                  <div style={{ fontSize: 11, color: THEME.textMuted, marginTop: -4, marginBottom: 8 }}>Excludes recurring & upcoming</div>
                  <VariableSpendChart
                    data={dailyData}
                    variableBudget={variableBudget}
                    fixed={fixedTotal}
                    todayDay={todayDay}
                    projectedVariable={projectedVariable}
                  />
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
                      <div><div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div><div style={{ fontSize: 11, color: "#6b7280" }}>{e.date}</div></div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#ef4444", fontSize: 13 }}>{fmt(e.amount)}</div>
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
                      <div><div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div><div style={{ fontSize: 11, color: "#6b7280" }}>Due {u.dueDate}</div></div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#f59e0b", fontSize: 13 }}>{fmt(u.amount)}</div>
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
                          <div style={{ fontSize: 11, color: "#6b7280" }}>{c.source} · {c.date}</div>
                        </div>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981", fontSize: 13 }}>+{fmt(c.amount)}</div>
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
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#ef4444", fontSize: 16 }}>Total: {fmt(totalExpenses)}</div>
              </div>
              {cur.expenses.length === 0 ? <div style={s.empty}>No expenses yet. Click "+ Add Expense" to start tracking.</div> : (
                <>
                  <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "CATEGORY", flex: 1.2 }, { label: "DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 0.3, align: "center" }]} />
                  {cur.expenses.map((e) => (
                    <div key={e.id} style={s.tableRow}>
                      <div style={{ flex: 2, fontWeight: 600 }}>{e.name}</div>
                      <div style={{ flex: 1.2 }}><CategoryPill categoryName={e.category} categories={data.categories} /></div>
                      <div style={{ flex: 1, color: "#6b7280", fontSize: 13 }}>{e.date}</div>
                      <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#ef4444" }}>{fmt(e.amount)}</div>
                      <div style={{ flex: 0.3, textAlign: "center" }}><button style={s.delBtn} onClick={() => patchCur({ expenses: cur.expenses.filter((x) => x.id !== e.id) })}>✕</button></div>
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
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#0066ff", fontSize: 16 }}>Monthly: {fmt(totalRecurring)}</div>
              </div>
              {cur.recurring.length === 0 ? <div style={s.empty}>No recurring payments set up. Click "+ Add Recurring" to create one.</div> : (
                <>
                  <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "CATEGORY", flex: 1.2 }, { label: "FREQUENCY", flex: 1 }, { label: "DAY", flex: 0.5, align: "center" }, { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 0.3, align: "center" }]} />
                  {cur.recurring.map((r) => (
                    <div key={r.id} style={s.tableRow}>
                      <div style={{ flex: 2, fontWeight: 600 }}>{r.name}</div>
                      <div style={{ flex: 1.2 }}><CategoryPill categoryName={r.category} categories={data.categories} /></div>
                      <div style={{ flex: 1, color: "#6b7280", fontSize: 13 }}>{r.frequency}</div>
                      <div style={{ flex: 0.5, textAlign: "center", color: "#6b7280", fontSize: 13 }}>{r.dayOfMonth || "—"}</div>
                      <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#0066ff" }}>{fmt(r.amount)}</div>
                      <div style={{ flex: 0.3, textAlign: "center" }}><button style={s.delBtn} onClick={() => save({
                        ...data,
                        months: { ...data.months, [curKey]: { ...cur, recurring: cur.recurring.filter((x) => x.id !== r.id) } },
                        recurringTemplate: data.recurringTemplate.filter((x) => !(x.name === r.name && x.amount === r.amount)),
                      })}>✕</button></div>
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
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#f59e0b", fontSize: 16 }}>Owed: {fmt(totalUpcoming)}</div>
              </div>
              {cur.upcoming.length === 0 ? <div style={s.empty}>No upcoming payments. Click "+ Add Payment" to schedule one.</div> : (
                <>
                  <TableHeader columns={[{ label: "", flex: 0.3 }, { label: "NAME", flex: 2 }, { label: "CATEGORY", flex: 1.2 }, { label: "DUE DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }, { label: "STATUS", flex: 0.7, align: "center" }, { label: "", flex: 0.3, align: "center" }]} />
                  {cur.upcoming.map((u) => (
                    <div key={u.id} style={{ ...s.tableRow, opacity: u.paid ? 0.4 : 1 }}>
                      <div style={{ flex: 0.3 }}>
                        <input type="checkbox" checked={!!u.paid}
                          onChange={() => patchCur({ upcoming: cur.upcoming.map((x) => x.id === u.id ? { ...x, paid: !x.paid } : x) })}
                          style={{ accentColor: "#10b981", width: 16, height: 16, cursor: "pointer" }} />
                      </div>
                      <div style={{ flex: 2, fontWeight: 600, textDecoration: u.paid ? "line-through" : "none" }}>{u.name}</div>
                      <div style={{ flex: 1.2 }}><CategoryPill categoryName={u.category} categories={data.categories} /></div>
                      <div style={{ flex: 1, color: "#6b7280", fontSize: 13 }}>{u.dueDate}</div>
                      <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: u.paid ? "#10b981" : "#f59e0b" }}>{fmt(u.amount)}</div>
                      <div style={{ flex: 0.7, textAlign: "center" }}>
                        <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600,
                          background: u.paid ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                          color: u.paid ? "#10b981" : "#f59e0b"
                        }}>{u.paid ? "Paid" : "Pending"}</span>
                      </div>
                      <div style={{ flex: 0.3, textAlign: "center" }}><button style={s.delBtn} onClick={() => patchCur({ upcoming: cur.upcoming.filter((x) => x.id !== u.id) })}>✕</button></div>
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
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981", fontSize: 16 }}>Total: {fmt(totalCredits)}</div>
              </div>
              {(cur.credits || []).length === 0 ? (
                <div style={s.empty}>No credits this month. Use "+ Add Credit" to log a refund, gift, or bonus.</div>
              ) : (
                <>
                  <TableHeader columns={[{ label: "NAME", flex: 2 }, { label: "SOURCE", flex: 1.2 }, { label: "DATE", flex: 1 }, { label: "AMOUNT", flex: 1, align: "right" }, { label: "", flex: 0.3, align: "center" }]} />
                  {[...cur.credits].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((c) => (
                    <div key={c.id} style={s.tableRow}>
                      <div style={{ flex: 2, fontWeight: 600 }}>{c.name}</div>
                      <div style={{ flex: 1.2, color: "#6b7280", fontSize: 13 }}>{c.source || "Other"}</div>
                      <div style={{ flex: 1, color: "#6b7280", fontSize: 13 }}>{c.date}</div>
                      <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#10b981" }}>+{fmt(c.amount)}</div>
                      <div style={{ flex: 0.3, textAlign: "center" }}>
                        <button style={s.delBtn} onClick={() => patchCur({ credits: cur.credits.filter((x) => x.id !== c.id) })}>✕</button>
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
                          background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20,
                          textAlign: "left", cursor: "pointer", display: "grid",
                          gridTemplateColumns: "1.5fr 1fr 1fr 1fr 8px", gap: 16, alignItems: "center",
                          color: "#0c0d12", fontFamily: "'DM Sans', sans-serif",
                        }}>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{monthLabel(k)}</div>
                          <div>
                            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Income</div>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{fmt(m.income)}</div>
                            {credits > 0 && (
                              <div style={{ fontSize: 10, color: "#10b981", fontFamily: "'JetBrains Mono', monospace" }}>+{fmt(credits)}</div>
                            )}
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Spent</div>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#ef4444" }}>{fmt(spent)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Remaining</div>
                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color }}>{fmt(rem)}</div>
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
                          <div style={{ flex: 1, color: "#6b7280", fontSize: 13 }}>{e.date}</div>
                          <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#ef4444" }}>{fmt(e.amount)}</div>
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
                          <div style={{ flex: 1, color: "#6b7280", fontSize: 13 }}>{r.frequency}</div>
                          <div style={{ flex: 0.5, textAlign: "center", color: "#6b7280", fontSize: 13 }}>{r.dayOfMonth || "—"}</div>
                          <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#0066ff" }}>{fmt(r.amount)}</div>
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
                          <div style={{ flex: 1, color: "#6b7280", fontSize: 13 }}>{u.dueDate}</div>
                          <div style={{ flex: 0.7, textAlign: "center", color: u.paid ? "#10b981" : "#6b7280", fontSize: 13 }}>{u.paid ? "Yes" : "No"}</div>
                          <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: u.paid ? "#10b981" : "#f59e0b" }}>{fmt(u.amount)}</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </div>
        </div>
      </main>

      {/* MODALS */}
      {modal?.type === "expense" && (
        <FormModal title="Add Expense" fields={[
          { key: "name", label: "Name", placeholder: "e.g. Groceries" },
          { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0" },
          { key: "category", label: "Category", type: "category", categories: data.categories },
          { key: "date", label: "Date", type: "date", defaultValue: new Date().toISOString().slice(0, 10) },
        ]} onClose={() => setModal(null)} onSave={(v) => {
          const { categories, category } = ensureCategory(data.categories, v.category);
          const newExp = { id: uid(), name: v.name, amount: +v.amount, date: v.date, category: category.name };
          save({
            ...data,
            categories,
            months: { ...data.months, [curKey]: { ...cur, expenses: [...cur.expenses, newExp] } },
          });
          setModal(null);
        }} />
      )}
      {modal?.type === "recurring" && (
        <FormModal title="Add Recurring Payment" fields={[
          { key: "name", label: "Name", placeholder: "e.g. Rent" },
          { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0" },
          { key: "category", label: "Category", type: "category", categories: data.categories },
          { key: "frequency", label: "Frequency", type: "select", options: ["Monthly", "Weekly", "Yearly"] },
          { key: "dayOfMonth", label: "Day of Month", type: "number", placeholder: "1" },
        ]} onClose={() => setModal(null)} onSave={(v) => {
          const { categories, category } = ensureCategory(data.categories, v.category);
          const newItem = { id: uid(), name: v.name, amount: +v.amount, frequency: v.frequency || "Monthly", dayOfMonth: +v.dayOfMonth || 1, category: category.name };
          save({
            ...data,
            categories,
            months: { ...data.months, [curKey]: { ...cur, recurring: [...cur.recurring, newItem] } },
            recurringTemplate: [...data.recurringTemplate, { ...newItem }],
          });
          setModal(null);
        }} />
      )}
      {modal?.type === "upcoming" && (
        <FormModal title="Add Upcoming Payment" fields={[
          { key: "name", label: "Name", placeholder: "e.g. Car Insurance" },
          { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0" },
          { key: "category", label: "Category", type: "category", categories: data.categories },
          { key: "dueDate", label: "Due Date", type: "date", defaultValue: new Date().toISOString().slice(0, 10) },
        ]} onClose={() => setModal(null)} onSave={(v) => {
          const { categories, category } = ensureCategory(data.categories, v.category);
          const newItem = { id: uid(), name: v.name, amount: +v.amount, dueDate: v.dueDate, paid: false, category: category.name };
          save({
            ...data,
            categories,
            months: { ...data.months, [curKey]: { ...cur, upcoming: [...cur.upcoming, newItem] } },
          });
          setModal(null);
        }} />
      )}
      {modal?.type === "credit" && (
        <FormModal title="Add Credit" fields={[
          { key: "name", label: "Name", placeholder: "e.g. Amazon refund" },
          { key: "amount", label: "Amount (PLN)", type: "number", placeholder: "0" },
          { key: "source", label: "Source", placeholder: "Refund, Gift, Bonus, Other" },
          { key: "date", label: "Date", type: "date", defaultValue: new Date().toISOString().slice(0, 10) },
        ]} onClose={() => setModal(null)} onSave={(v) => {
          const amt = +v.amount;
          if (!v.name || !(amt > 0)) { setModal(null); return; }
          const newCredit = { id: uid(), name: v.name, amount: amt, date: v.date, source: (v.source || "Other").trim() || "Other" };
          patchCur({ credits: [...(cur.credits || []), newCredit] });
          setModal(null);
        }} />
      )}
    </div>
  );
}

const s = {
  shell: { display: "flex", height: "100vh", background: THEME.outerBg, color: THEME.text, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" },
  sidebar: { width: 240, minWidth: 240, background: THEME.outerBg, borderRight: "none", display: "flex", flexDirection: "column", height: "100vh" },
  logo: { padding: "28px 24px 24px", borderBottom: `1px solid ${THEME.border}` },
  nav: { padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4, flex: 1 },
  navItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: "none", background: "transparent", color: THEME.outerTextMuted, fontSize: 14, fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", textAlign: "left", width: "100%" },
  navItemActive: { background: THEME.outerAccentSoft, color: "#ffffff" },
  badge: { background: THEME.warning, color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 999, padding: "1px 7px", marginLeft: "auto" },
  sidebarIncome: { padding: "16px 20px", borderTop: "1px solid " + THEME.outerBorder },
  incomeInput: { background: THEME.outerBorder, border: "1px solid " + THEME.outerBorder, borderRadius: 10, padding: "10px 12px", color: THEME.success, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 16, width: "100%", textAlign: "right", outline: "none", boxSizing: "border-box" },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: THEME.outerBg },
  topbar: { padding: "24px 36px 20px", borderBottom: "none", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, background: THEME.outerBg },
  content: { flex: 1, overflow: "auto", background: THEME.bg, borderRadius: 20, margin: "0 16px 16px 0", padding: 32 },
  contentInner: { maxWidth: 1400, margin: "0 auto" },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 24 },
  statCard: { background: THEME.surface, borderRadius: 16, padding: 20, border: `1px solid ${THEME.border}`, boxShadow: THEME.shadowCard },
  dashGrid: { display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16 },
  card: { background: THEME.surface, borderRadius: 16, padding: 24, border: `1px solid ${THEME.border}`, boxShadow: THEME.shadowCard },
  cardTitle: { fontSize: 12, textTransform: "uppercase", letterSpacing: 1.2, color: THEME.textMuted, fontWeight: 700 },
  linkBtn: { background: "none", border: "none", color: THEME.accent, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600 },
  breakdownBar: { display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: THEME.bg, marginTop: 12 },
  tableHeader: { display: "flex", padding: "12px 16px", borderBottom: `1px solid ${THEME.border}`, marginTop: 16, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: THEME.textFaint, fontWeight: 700 },
  tableRow: { display: "flex", alignItems: "center", padding: "14px 16px", borderBottom: `1px solid ${THEME.border}`, fontSize: 14 },
  miniRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${THEME.border}` },
  addBtn: { background: THEME.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  delBtn: { background: "none", border: "none", color: THEME.textFaint, cursor: "pointer", fontSize: 14, padding: "4px 8px" },
  empty: { textAlign: "center", color: THEME.textFaint, padding: "60px 20px", fontSize: 14 },
  emptySmall: { textAlign: "center", color: THEME.textFaint, padding: "24px 0", fontSize: 13 },
  overlay: { position: "fixed", inset: 0, background: "rgba(12,13,18,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modal: { background: THEME.surface, borderRadius: 16, padding: 28, width: "100%", maxWidth: 460, border: `1px solid ${THEME.border}`, boxShadow: "0 20px 40px rgba(0,0,0,0.12)" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  closeBtn: { background: "none", border: "none", color: THEME.textFaint, fontSize: 20, cursor: "pointer" },
  input: { width: "100%", background: THEME.bg, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "11px 14px", color: THEME.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" },
  saveBtn: { width: "100%", background: THEME.accent, color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontWeight: 700, fontSize: 14, cursor: "pointer", marginTop: 8, fontFamily: "'DM Sans', sans-serif" },
  catPill: { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px 4px 4px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  catDot: { width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 },
  suggestBox: { position: "absolute", top: "100%", left: 0, right: 0, background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 10, boxShadow: THEME.shadowCard, zIndex: 10, maxHeight: 200, overflow: "auto", marginTop: 4 },
  suggestItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", fontSize: 14 },
  chartEmpty: { textAlign: "center", color: THEME.textFaint, padding: "80px 20px", fontSize: 13 },
  chartTooltip: { background: THEME.surface, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: THEME.text, boxShadow: THEME.shadowCard },
};