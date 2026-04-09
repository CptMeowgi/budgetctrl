# Monthly History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor data to be month-keyed, auto-create current month on load, and add a History tab to view past months read-only.

**Architecture:** Replace the flat `data` shape with `{ months: {YYYY-MM: {...}}, savingsGoalPercent, recurringTemplate }`. All existing tabs operate on `months[currentKey]` where `currentKey` is the current calendar month. A new History tab lists past months and drills into a read-only detail view. Migration runs once on load to convert existing flat data. Recurring template is the "live" list; each month gets its own snapshot so historical totals stay accurate.

**Tech Stack:** React 19, Vite, localStorage via `window.storage` shim. No test framework — verification via Claude Preview MCP (`preview_eval`, `preview_click`, `preview_fill`).

**Reference:** `docs/plans/2026-04-09-monthly-history-design.md`

**Conventions for this plan:**
- No git commits (repo is not under version control).
- Preview server is already running on port 5173 (serverId from active session). Each task ends with a preview-based verification step.
- All file paths are absolute Windows paths using forward slashes where possible.
- Single file of interest: `src/App.jsx`.

---

### Task 1: Add pure helpers for month keys and migration

**Files:**
- Modify: `src/App.jsx` — add helpers near top, below `fmt()` at line ~37

**Step 1: Add helper functions**

Add these pure functions after the existing `fmt` helper in `src/App.jsx`:

```js
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
  return { income: 0, expenses: [], recurring: [], upcoming: [] };
}

// Migrate old flat shape { monthlyIncome, expenses, recurring, upcoming, savingsGoalPercent }
// into new shape. Idempotent: if already migrated, returns input unchanged.
function migrate(raw) {
  if (!raw || typeof raw !== "object") return defaultData();
  if (raw.months && raw.recurringTemplate) return raw; // already migrated
  const cur = currentMonthKey();
  const months = {};
  const oldExpenses = Array.isArray(raw.expenses) ? raw.expenses : [];
  const oldUpcoming = Array.isArray(raw.upcoming) ? raw.upcoming : [];
  const oldRecurring = Array.isArray(raw.recurring) ? raw.recurring : [];

  // Seed current month so it exists even if old data is empty
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

function defaultData() {
  const cur = currentMonthKey();
  return {
    months: { [cur]: emptyMonth() },
    savingsGoalPercent: 20,
    recurringTemplate: [],
  };
}

// Ensure months[currentKey] exists; if not, create it by snapshotting the
// recurring template and carrying previous month's income. Returns new data
// object if a change was made, otherwise returns the input unchanged.
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
        recurring: (data.recurringTemplate || []).map((r) => ({ ...r })),
        upcoming: [],
      },
    },
  };
}
```

Also remove the old top-level `defaultData` constant (lines 23-29) since it's now a function.

**Step 2: Verify no syntax errors**

Run in preview:

```js
mcp__Claude_Preview__preview_console_logs (level: error)
```

Expected: no errors. The dev server hot-reloads on save.

**Step 3: Unit-test helpers via preview_eval**

Since React component internals aren't directly exposed, expose helpers on `window` temporarily for testing. Add at the bottom of `src/App.jsx` (just above `export default`):

```js
if (typeof window !== "undefined") {
  window.__budgetTest = { monthKey, currentMonthKey, monthLabel, prevMonthKey, migrate, ensureCurrentMonth };
}
```

Then run:

```js
preview_eval:
(() => {
  const t = window.__budgetTest;
  const r = {};
  r.monthKey = t.monthKey("2026-04-09") === "2026-04";
  r.monthKeyInvalid = t.monthKey("not-a-date") === null;
  r.prevMonthKey = t.prevMonthKey("2026-01") === "2025-12";
  r.monthLabel = t.monthLabel("2026-04") === "April 2026";
  const migrated = t.migrate({
    monthlyIncome: 5000,
    expenses: [{ id: "a", name: "x", amount: 10, date: "2026-03-15" }, { id: "b", name: "y", amount: 20, date: "2026-04-01" }],
    recurring: [{ id: "r", name: "rent", amount: 1500, frequency: "Monthly", dayOfMonth: 1 }],
    upcoming: [],
    savingsGoalPercent: 25,
  });
  r.migratedShape = !!migrated.months && !!migrated.recurringTemplate;
  r.migratedExpenses = migrated.months["2026-03"].expenses.length === 1 && migrated.months["2026-04"].expenses.length === 1;
  r.migratedTemplate = migrated.recurringTemplate.length === 1;
  r.migratedIncome = migrated.months["2026-04"].income === 5000;
  r.migratedSnapshot = migrated.months["2026-04"].recurring.length === 1;
  r.migrateIdempotent = t.migrate(migrated) === migrated;
  r.ensureCreatesFuture = (() => {
    const d = { months: { "2026-03": { income: 7000, expenses: [], recurring: [], upcoming: [] } }, recurringTemplate: [{ id: "x", name: "n", amount: 5, frequency: "Monthly", dayOfMonth: 1 }], savingsGoalPercent: 20 };
    // Note: test uses real current month — on 2026-04-09 this should create "2026-04"
    const after = t.ensureCurrentMonth(d);
    return after.months["2026-04"] && after.months["2026-04"].income === 7000 && after.months["2026-04"].recurring.length === 1;
  })();
  return r;
})()
```

Expected: all values `true`.

**Step 4: Remove the test export** (optional, keep if useful during later tasks)

Leave `window.__budgetTest` in place — it's useful for subsequent tasks.

---

### Task 2: Refactor App state to new shape (current month is read-through)

**Files:**
- Modify: `src/App.jsx` — `App` component (lines 105-135 area)

**Step 1: Replace state initialization**

In the `App` component, replace:

```js
const [data, setData] = useState(defaultData);
```

with:

```js
const [data, setData] = useState(defaultData());
```

(Note: `defaultData` is now a function.)

**Step 2: Update load effect to run migration and ensureCurrentMonth**

Replace the existing `useEffect` load block (lines ~111-119) with:

```js
useEffect(() => {
  (async () => {
    try {
      const r = await window.storage.get(STORAGE_KEY);
      if (r?.value) {
        const raw = JSON.parse(r.value);
        const migrated = ensureCurrentMonth(migrate(raw));
        setData(migrated);
        // Persist migration so next load is fast
        if (migrated !== raw) {
          try { await window.storage.set(STORAGE_KEY, JSON.stringify(migrated)); } catch {}
        }
      }
    } catch {}
    setLoaded(true);
  })();
}, []);
```

**Step 3: Add `curKey` and `cur` derived values after `save` definition**

```js
const curKey = currentMonthKey();
const cur = data.months[curKey] || emptyMonth();
```

**Step 4: Replace totals block (lines ~128-135) to read from `cur`**

```js
const totalExpenses = cur.expenses.reduce((a, e) => a + e.amount, 0);
const totalRecurring = cur.recurring.reduce((a, e) => a + e.amount, 0);
const totalUpcoming = cur.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
const totalCommitted = totalExpenses + totalRecurring + totalUpcoming;
const savingsTarget = (cur.income * data.savingsGoalPercent) / 100;
const canInvest = Math.max(0, cur.income - totalCommitted - savingsTarget);
const remaining = cur.income - totalExpenses - totalRecurring;
const unpaidCount = cur.upcoming.filter((u) => !u.paid).length;
```

**Step 5: Verify app loads with migrated data**

```js
preview_eval:
(async () => {
  // Seed old-shape data
  await window.storage.set("budget-app-data", JSON.stringify({
    monthlyIncome: 8000,
    savingsGoalPercent: 20,
    expenses: [{ id: "e1", name: "Old expense", amount: 200, date: "2026-03-10" }, { id: "e2", name: "New expense", amount: 50, date: "2026-04-05" }],
    recurring: [{ id: "r1", name: "Rent", amount: 1500, frequency: "Monthly", dayOfMonth: 1 }],
    upcoming: [],
  }));
  location.reload();
})()
```

After reload (wait ~1s), run:

```js
preview_eval:
(async () => {
  await new Promise(r => setTimeout(r, 800));
  const raw = JSON.parse((await window.storage.get("budget-app-data")).value);
  return {
    migrated: !!raw.months && !!raw.recurringTemplate,
    hasMarch: !!raw.months["2026-03"],
    hasApril: !!raw.months["2026-04"],
    aprilIncome: raw.months["2026-04"]?.income,
    aprilExpenses: raw.months["2026-04"]?.expenses.length,
    aprilRecurring: raw.months["2026-04"]?.recurring.length,
    marchExpenses: raw.months["2026-03"]?.expenses.length,
    dashboardBody: document.body.innerText.slice(150, 400),
  };
})()
```

Expected: `migrated: true`, `hasMarch: true`, `hasApril: true`, `aprilIncome: 8000`, `aprilExpenses: 1`, `aprilRecurring: 1`, `marchExpenses: 1`. Dashboard body should show current (April) numbers, not March.

---

### Task 3: Update current-month writes — expenses, income, upcoming

**Files:**
- Modify: `src/App.jsx` — modal save handlers and income input

**Step 1: Add a helper `patchCur` inside `App`**

After `save` definition (~line 124):

```js
const patchCur = useCallback((patch) => {
  save({
    ...data,
    months: {
      ...data.months,
      [curKey]: { ...cur, ...patch },
    },
  });
}, [data, curKey, cur, save]);
```

Note: `curKey` and `cur` must be defined BEFORE this `useCallback`. Move their definitions up, or inline them inside the callback. Simplest: inline.

Rewrite as:

```js
const patchCur = useCallback((patch) => {
  const key = currentMonthKey();
  const curMonth = data.months[key] || emptyMonth();
  save({
    ...data,
    months: { ...data.months, [key]: { ...curMonth, ...patch } },
  });
}, [data, save]);
```

**Step 2: Update the Expense modal save handler**

Find lines ~362-371. Replace:

```jsx
}} />
  )}
  {modal?.type === "expense" && (
    <FormModal title="Add Expense" fields={[
      ...
    ]} onClose={() => setModal(null)} onSave={(v) => {
      save({ ...data, expenses: [...data.expenses, { id: uid(), name: v.name, amount: +v.amount, date: v.date }] });
      setModal(null);
    }} />
  )}
```

New handler body:

```jsx
onSave={(v) => {
  patchCur({ expenses: [...cur.expenses, { id: uid(), name: v.name, amount: +v.amount, date: v.date }] });
  setModal(null);
}}
```

**Step 3: Update the Upcoming modal save handler**

Similarly for upcoming (lines ~383-392):

```jsx
onSave={(v) => {
  patchCur({ upcoming: [...cur.upcoming, { id: uid(), name: v.name, amount: +v.amount, dueDate: v.dueDate, paid: false }] });
  setModal(null);
}}
```

**Step 4: Update income input**

Find the sidebar income input. It currently reads `data.monthlyIncome` and writes with `save({ ...data, monthlyIncome: ... })`. Change to read `cur.income` and write `patchCur({ income: ... })`.

Search for `monthlyIncome` in `src/App.jsx` — replace all reads (in stats already updated Task 2) and the sidebar input write.

**Step 5: Update expense delete button**

Find where expenses are rendered with a delete button (likely `data.expenses.filter(...)`). Change to:

```jsx
onClick={() => patchCur({ expenses: cur.expenses.filter((x) => x.id !== e.id) })}
```

**Step 6: Update upcoming paid toggle and delete**

Same pattern — use `patchCur({ upcoming: ... })`.

**Step 7: Verify end-to-end in preview**

```js
preview_eval:
(async () => {
  // Navigate to Expenses tab
  const tabs = [...document.querySelectorAll('button')];
  tabs.find(b => b.innerText.includes('Expenses')).click();
  await new Promise(r => setTimeout(r, 200));
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('Add Expense')).click();
  await new Promise(r => setTimeout(r, 200));
  const setVal = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')];
  setVal(inputs.find(i => i.placeholder === 'e.g. Groceries'), 'Coffee');
  setVal(inputs.filter(i => i.placeholder === '0')[1], '15');
  await new Promise(r => setTimeout(r, 100));
  [...document.querySelectorAll('button')].find(b => b.innerText === 'Save').click();
  await new Promise(r => setTimeout(r, 300));
  const stored = JSON.parse((await window.storage.get("budget-app-data")).value);
  return {
    currentMonthExpenses: stored.months["2026-04"]?.expenses.map(e => ({ name: e.name, amount: e.amount })),
  };
})()
```

Expected: `currentMonthExpenses` contains `{ name: "Coffee", amount: 15 }` (plus whatever was there from migration test).

---

### Task 4: Update recurring writes — snapshot AND template

**Files:**
- Modify: `src/App.jsx` — recurring modal save handler and delete button

**Step 1: Update Add Recurring save handler**

Find lines ~372-382. Change to:

```jsx
onSave={(v) => {
  const newItem = { id: uid(), name: v.name, amount: +v.amount, frequency: v.frequency || "Monthly", dayOfMonth: +v.dayOfMonth || 1 };
  save({
    ...data,
    months: {
      ...data.months,
      [curKey]: { ...cur, recurring: [...cur.recurring, newItem] },
    },
    recurringTemplate: [...data.recurringTemplate, { ...newItem }],
  });
  setModal(null);
}}
```

(This updates BOTH the current month snapshot AND the template.)

**Step 2: Update recurring delete button**

Find where recurring entries are deleted (currently: `save({ ...data, recurring: data.recurring.filter(...) })`). Change to:

```jsx
onClick={() => save({
  ...data,
  months: {
    ...data.months,
    [curKey]: { ...cur, recurring: cur.recurring.filter((x) => x.id !== r.id) },
  },
  recurringTemplate: data.recurringTemplate.filter((x) => x.name !== r.name || x.amount !== r.amount),
})}
```

Note: recurring items in snapshot have fresh IDs from template entries, so we match by name+amount for template removal. Alternative: store a `templateId` on each snapshot item. Go with name+amount match for simplicity — the user has a small personal list.

**Step 3: Update Recurring tab to read from `cur.recurring`**

Find line ~302 `{tab === "recurring" && (` and replace `data.recurring` references with `cur.recurring`. Also line 308 `data.recurring.length === 0` etc.

**Step 4: Verify recurring edit doesn't affect past months**

```js
preview_eval:
(async () => {
  // Seed: current April + a past March month with its own recurring snapshot
  const seed = {
    months: {
      "2026-03": { income: 7000, expenses: [], recurring: [{ id: "old", name: "Old Rent", amount: 1200, frequency: "Monthly", dayOfMonth: 1 }], upcoming: [] },
      "2026-04": { income: 8000, expenses: [], recurring: [{ id: "cur", name: "Rent", amount: 1500, frequency: "Monthly", dayOfMonth: 1 }], upcoming: [] },
    },
    recurringTemplate: [{ id: "tpl", name: "Rent", amount: 1500, frequency: "Monthly", dayOfMonth: 1 }],
    savingsGoalPercent: 20,
  };
  await window.storage.set("budget-app-data", JSON.stringify(seed));
  location.reload();
})()
```

Wait ~1s, then:

```js
preview_eval:
(async () => {
  await new Promise(r => setTimeout(r, 800));
  // Navigate to Recurring tab
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('Recurring')).click();
  await new Promise(r => setTimeout(r, 200));
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('Add Recurring')).click();
  await new Promise(r => setTimeout(r, 200));
  const setVal = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    s.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')];
  setVal(inputs.find(i => i.placeholder === 'e.g. Rent'), 'Netflix');
  setVal(inputs.filter(i => i.placeholder === '0')[1], '50');
  await new Promise(r => setTimeout(r, 100));
  [...document.querySelectorAll('button')].find(b => b.innerText === 'Save').click();
  await new Promise(r => setTimeout(r, 300));
  const stored = JSON.parse((await window.storage.get("budget-app-data")).value);
  return {
    marchRecurring: stored.months["2026-03"].recurring.map(r => r.name),
    aprilRecurring: stored.months["2026-04"].recurring.map(r => r.name),
    template: stored.recurringTemplate.map(r => r.name),
  };
})()
```

Expected: `marchRecurring: ["Old Rent"]` (unchanged), `aprilRecurring: ["Rent", "Netflix"]`, `template: ["Rent", "Netflix"]`.

---

### Task 5: Add History tab to sidebar

**Files:**
- Modify: `src/App.jsx` — `TABS` constant (line ~16), sidebar rendering

**Step 1: Add History to TABS**

Change the TABS constant:

```js
const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "◉" },
  { id: "expenses", label: "Expenses", icon: "↗" },
  { id: "recurring", label: "Recurring", icon: "↻" },
  { id: "upcoming", label: "Upcoming", icon: "◈" },
  { id: "history", label: "History", icon: "◷" },
];
```

**Step 2: Verify tab appears and is clickable**

```js
preview_eval:
(async () => {
  const btns = [...document.querySelectorAll('button')].map(b => b.innerText).filter(t => t.length < 30);
  return { buttons: btns };
})()
```

Expected: output includes `"◷\nHistory"`.

---

### Task 6: History list view

**Files:**
- Modify: `src/App.jsx` — add a new tab block for `tab === "history"` near the other tab content

**Step 1: Add a historyView state for navigating list vs detail**

In `App` component state:

```js
const [historyKey, setHistoryKey] = useState(null); // null = list, otherwise showing that month's detail
```

Reset it when switching tabs:

```js
// Replace existing setTab callbacks in sidebar nav with:
onClick={() => { setTab(t.id); if (t.id !== "history") setHistoryKey(null); }}
```

**Step 2: Add history list render block**

Near the other tab blocks (after the `{tab === "upcoming" && ...}` block, before the modal block), add:

```jsx
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
            const spent = m.expenses.reduce((a, e) => a + e.amount, 0) + m.recurring.reduce((a, e) => a + e.amount, 0);
            const rem = m.income - spent;
            const color = rem >= 0 ? "#34d399" : "#ef4444";
            return (
              <button key={k} onClick={() => setHistoryKey(k)} style={{
                background: "#14151c", border: "1px solid #1e2028", borderRadius: 12, padding: 20,
                textAlign: "left", cursor: "pointer", display: "grid",
                gridTemplateColumns: "1.5fr 1fr 1fr 1fr 8px", gap: 16, alignItems: "center",
                color: "#e4e5e7", fontFamily: "'DM Sans', sans-serif",
              }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{monthLabel(k)}</div>
                <div><div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Income</div><div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{fmt(m.income)}</div></div>
                <div><div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Spent</div><div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: "#f472b6" }}>{fmt(spent)}</div></div>
                <div><div style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase" }}>Remaining</div><div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color }}>{fmt(rem)}</div></div>
                <div style={{ width: 8, height: 40, background: color, borderRadius: 4 }} />
              </button>
            );
          })}
        </div>
      );
    })()}
  </div>
)}
```

**Step 3: Verify History list shows past months**

```js
preview_eval:
(async () => {
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('History')).click();
  await new Promise(r => setTimeout(r, 200));
  return { body: document.body.innerText.slice(140, 600) };
})()
```

Expected: body contains `"Past Months"`, `"March 2026"`, and spent/income/remaining labels (assuming the seed from Task 4 still has March data).

---

### Task 7: History detail view

**Files:**
- Modify: `src/App.jsx` — add detail render block alongside list block

**Step 1: Add detail view render block**

Next to the list block:

```jsx
{tab === "history" && historyKey !== null && (() => {
  const m = data.months[historyKey] || emptyMonth();
  const spent = m.expenses.reduce((a, e) => a + e.amount, 0);
  const rec = m.recurring.reduce((a, e) => a + e.amount, 0);
  const upc = m.upcoming.filter((u) => !u.paid).reduce((a, e) => a + e.amount, 0);
  const committed = spent + rec + upc;
  const sTarget = (m.income * data.savingsGoalPercent) / 100;
  const canInv = Math.max(0, m.income - committed - sTarget);
  const rem = m.income - spent - rec;
  return (
    <>
      <button style={{ ...s.linkBtn, marginBottom: 16 }} onClick={() => setHistoryKey(null)}>← Back to History</button>
      <div style={{ ...s.statsRow, marginTop: 8 }}>
        <StatCard label="Income" value={fmt(m.income)} accent="#34d399" sub={monthLabel(historyKey)} icon="↑" />
        <StatCard label="Remaining" value={fmt(rem)} accent={rem >= 0 ? "#34d399" : "#ef4444"} sub="After expenses & recurring" icon="↓" />
        <StatCard label="Total Spent" value={fmt(spent + rec)} accent="#f472b6" sub={`${m.expenses.length} one-off · ${m.recurring.length} recurring`} icon="↻" />
        <StatCard label="Can Invest" value={fmt(canInv)} accent="#818cf8" sub={`After ${data.savingsGoalPercent}% savings goal`} icon="↗" />
      </div>
      <div style={s.card}>
        <div style={s.cardTitle}>Expenses</div>
        {m.expenses.length === 0 ? <div style={s.emptySmall}>No expenses</div> : (
          <>
            <TableHeader columns={[{ label: "Name", flex: 2 }, { label: "Date" }, { label: "Amount", align: "right" }]} />
            {m.expenses.map((e) => (
              <div key={e.id} style={s.tableRow}>
                <div style={{ flex: 2 }}>{e.name}</div>
                <div style={{ flex: 1, color: "#6b7280" }}>{e.date}</div>
                <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{fmt(e.amount)}</div>
              </div>
            ))}
          </>
        )}
      </div>
      <div style={{ ...s.card, marginTop: 16 }}>
        <div style={s.cardTitle}>Recurring</div>
        {m.recurring.length === 0 ? <div style={s.emptySmall}>No recurring</div> : (
          <>
            <TableHeader columns={[{ label: "Name", flex: 2 }, { label: "Frequency" }, { label: "Day" }, { label: "Amount", align: "right" }]} />
            {m.recurring.map((r) => (
              <div key={r.id} style={s.tableRow}>
                <div style={{ flex: 2 }}>{r.name}</div>
                <div style={{ flex: 1, color: "#6b7280" }}>{r.frequency}</div>
                <div style={{ flex: 1, color: "#6b7280" }}>{r.dayOfMonth}</div>
                <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{fmt(r.amount)}</div>
              </div>
            ))}
          </>
        )}
      </div>
      <div style={{ ...s.card, marginTop: 16 }}>
        <div style={s.cardTitle}>Upcoming</div>
        {m.upcoming.length === 0 ? <div style={s.emptySmall}>No upcoming</div> : (
          <>
            <TableHeader columns={[{ label: "Name", flex: 2 }, { label: "Due Date" }, { label: "Paid" }, { label: "Amount", align: "right" }]} />
            {m.upcoming.map((u) => (
              <div key={u.id} style={s.tableRow}>
                <div style={{ flex: 2 }}>{u.name}</div>
                <div style={{ flex: 1, color: "#6b7280" }}>{u.dueDate}</div>
                <div style={{ flex: 1, color: u.paid ? "#34d399" : "#6b7280" }}>{u.paid ? "Yes" : "No"}</div>
                <div style={{ flex: 1, textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{fmt(u.amount)}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
})()}
```

**Step 2: Verify detail view renders**

```js
preview_eval:
(async () => {
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('History')).click();
  await new Promise(r => setTimeout(r, 200));
  const marchBtn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('March 2026'));
  marchBtn.click();
  await new Promise(r => setTimeout(r, 200));
  const hasBack = !![...document.querySelectorAll('button')].find(b => b.innerText.includes('Back to History'));
  return { hasBack, body: document.body.innerText.slice(140, 700) };
})()
```

Expected: `hasBack: true`, body shows March income/remaining/spent stats and the March recurring entries.

**Step 3: Verify Back button returns to list**

```js
preview_eval:
(async () => {
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('Back to History')).click();
  await new Promise(r => setTimeout(r, 200));
  return { hasList: document.body.innerText.includes('Past Months') };
})()
```

Expected: `hasList: true`.

---

### Task 8: Full end-to-end sanity check

**Step 1: Reset and exercise the full flow**

```js
preview_eval:
(async () => {
  // Reset storage to defaults
  await window.storage.set("budget-app-data", JSON.stringify({
    monthlyIncome: 6000,
    savingsGoalPercent: 20,
    expenses: [{ id: "e1", name: "Old March Expense", amount: 300, date: "2026-03-15" }],
    recurring: [{ id: "r1", name: "Rent", amount: 1500, frequency: "Monthly", dayOfMonth: 1 }],
    upcoming: [],
  }));
  location.reload();
})()
```

Wait ~1s, then:

```js
preview_eval:
(async () => {
  await new Promise(r => setTimeout(r, 800));
  const stored = JSON.parse((await window.storage.get("budget-app-data")).value);
  // Navigate to history to verify migration
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('History')).click();
  await new Promise(r => setTimeout(r, 200));
  return {
    migrated: !!stored.months,
    marchExists: !!stored.months["2026-03"],
    aprilExists: !!stored.months["2026-04"],
    aprilHasRecurring: stored.months["2026-04"]?.recurring.length === 1,
    template: stored.recurringTemplate?.length,
    pastMonthsShown: document.body.innerText.includes('March 2026'),
  };
})()
```

Expected all truthy.

**Step 2: Cleanup test hook (optional)**

Remove the `window.__budgetTest` export from Task 1 if no longer needed, or leave it for future debugging.

---

## Checklist

- [ ] Task 1: helpers added and unit-tested
- [ ] Task 2: state refactored, migration runs on load
- [ ] Task 3: expense/upcoming/income writes use current month
- [ ] Task 4: recurring writes update snapshot AND template, past months unaffected
- [ ] Task 5: History tab appears in sidebar
- [ ] Task 6: History list view shows past months
- [ ] Task 7: History detail view is read-only and Back works
- [ ] Task 8: end-to-end sanity passes
