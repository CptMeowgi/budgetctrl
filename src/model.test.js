import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { countRebucketMoves, hydrate, migrate, rebucketData, uid } from "./model.js";
import { readFileSync } from "node:fs";
import { calendarFor, monthlyCalendar } from "./lib/calendar.js";
import { capAt, envelope } from "./lib/envelopes.js";
import { missingCopies } from "./lib/occurrences.js";
import { isOnCycle } from "./lib/schedule.js";
import { periodIncome, periodSpending } from "./lib/totals.js";

// A budget exactly as 0.4.2 saved it: the shape of that version's
// defaultData() with two months of use. 0.4.x kept it in the webview's
// localStorage under "budget-app-data"; 0.5 adopts it from there on first
// launch and runs it through migrate() and hydrate(), as here.
const SAVED_BY_0_4_2 = {
  months: {
    "2026-08": {
      income: 8500,
      expenses: [
        { id: "e1", name: "Biedronka", amount: 186.4, date: "2026-08-03", category: "Groceries" },
        { id: "e2", name: "Orlen", amount: 240, date: "2026-08-07", category: "Transport" },
      ],
      recurring: [
        { id: "r1", name: "Rent", amount: 2400, dayOfMonth: 1, category: "Home", templateId: "t1" },
        { id: "r2", name: "Netflix", amount: 49, dayOfMonth: 20, category: "Fun", autoPay: true, templateId: "t2" },
      ],
      upcoming: [{ id: "u1", name: "Dentist", amount: 300, dueDate: "2026-08-14", category: "Health", paid: true }],
      credits: [{ id: "c1", name: "Tax refund", amount: 420, date: "2026-08-06", category: "Refund" }],
    },
    "2026-09": {
      income: 8700,
      expenses: [{ id: "e3", name: "Lidl", amount: 154.2, date: "2026-09-16", category: "Groceries" }],
      recurring: [
        { id: "r3", name: "Rent", amount: 2400, dayOfMonth: 1, category: "Home", templateId: "t1" },
        { id: "r4", name: "Netflix", amount: 49, dayOfMonth: 20, category: "Fun", autoPay: true, templateId: "t2" },
      ],
      upcoming: [{ id: "u2", name: "Car insurance", amount: 860, dueDate: "2026-09-25", category: "Transport", paid: false }],
      credits: [{ id: "c2", name: "Allowance", amount: 300, dayOfMonth: 10, category: "Gift", templateId: "ct1" }],
    },
  },
  savingsGoal: { monthly: 500, target: 20000 },
  startingBalance: 3500,
  cutoffDay: 1,
  recurringTemplate: [
    { id: "t1", name: "Rent", amount: 2400, dayOfMonth: 1, category: "Home" },
    { id: "t2", name: "Netflix", amount: 49, dayOfMonth: 20, category: "Fun", autoPay: true },
  ],
  creditTemplate: [{ id: "ct1", name: "Allowance", amount: 300, dayOfMonth: 10, category: "Gift" }],
  categories: [
    { name: "Uncategorized", color: "#9ca3af", icon: "·" },
    { name: "Groceries", color: "#10b981", icon: "🍔", cap: 1200 },
    { name: "Transport", color: "#f59e0b", icon: "🚗" },
    { name: "Home", color: "#0066cc", icon: "🏠" },
    { name: "Fun", color: "#8b5cf6", icon: "🎮" },
    { name: "Health", color: "#ec4899", icon: "💊" },
  ],
  creditCategories: [
    { name: "Refund", color: "#10b981", icon: "↩" },
    { name: "Gift", color: "#ec4899", icon: "🎁" },
    { name: "Bonus", color: "#f59e0b", icon: "⭐" },
    { name: "Salary", color: "#0066cc", icon: "💼" },
    { name: "Other", color: "#9ca3af", icon: "·" },
  ],
  reminders: { enabled: true, leadDays: 5 },
};

describe("opening a budget saved by 0.4.2", () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 11, 12)); });
  afterAll(() => vi.useRealTimers());

  const open = () => hydrate(migrate(structuredClone(SAVED_BY_0_4_2)));

  it("keeps every month and every entry in it", () => {
    const d = open();
    for (const [key, before] of Object.entries(SAVED_BY_0_4_2.months)) {
      const after = d.months[key];
      expect(after.income).toBe(before.income);
      for (const list of ["expenses", "recurring", "upcoming", "credits"]) {
        expect(after[list].map((e) => [e.name, e.amount])).toEqual(before[list].map((e) => [e.name, e.amount]));
      }
    }
  });

  it("adds up to the same totals as before", () => {
    const d = open();
    const today = new Date(2026, 9, 11);
    // August: 426.40 of shopping and fuel, both bills, the paid dentist.
    expect(periodSpending(d.months["2026-08"], "2026-08", today, 1).total).toBeCloseTo(186.4 + 240 + 2400 + 49 + 300);
    expect(periodIncome(d.months["2026-08"], "2026-08", today, 1).total).toBe(8500 + 420);
    expect(periodIncome(d.months["2026-09"], "2026-09", today, 1).total).toBe(8700 + 300);
  });

  it("starts the current month from the templates, carrying the income", () => {
    const d = open();
    expect(d.months["2026-10"].income).toBe(8700);
    expect(d.months["2026-10"].recurring.map((r) => r.name)).toEqual(["Rent", "Netflix"]);
    expect(d.months["2026-10"].credits.map((c) => c.name)).toEqual(["Allowance"]);
  });

  it("keeps the recurring bills, credits, categories and category budgets", () => {
    const d = open();
    expect(d.recurringTemplate.map((r) => [r.name, r.amount, r.dayOfMonth, !!r.autoPay])).toEqual([["Rent", 2400, 1, false], ["Netflix", 49, 20, true]]);
    expect(d.creditTemplate.map((c) => [c.name, c.amount, c.dayOfMonth])).toEqual([["Allowance", 300, 10]]);
    expect(d.categories.map((c) => c.name)).toEqual(SAVED_BY_0_4_2.categories.map((c) => c.name));
    expect(capAt(d.categories.find((c) => c.name === "Groceries"), "2026-10")).toBe(1200);
    expect(d.creditCategories.map((c) => c.name)).toEqual(SAVED_BY_0_4_2.creditCategories.map((c) => c.name));
  });

  it("turns the savings target and starting balance into a goal, keeping what is set aside", () => {
    const d = open();
    expect(d.savingsGoal).toEqual({ monthly: 500 });
    expect(d.goals).toEqual([expect.objectContaining({ name: "Savings", target: 20000, startAmount: 3500, source: "budget" })]);
    expect(d).not.toHaveProperty("startingBalance");
  });

  it("keeps the settings, and the złoty formatting it always showed", () => {
    const d = open();
    expect(d.cutoffDay).toBe(1);
    expect(d.reminders).toEqual({ enabled: true, leadDays: 5 });
    expect(d.currency).toBe("PLN");
    expect(d.locale).toBe("pl-PL");
  });

  it("changes nothing when opened a second time", () => {
    const once = open();
    expect(hydrate(migrate(structuredClone(once)))).toEqual(once);
  });
});

describe("a budget missing parts of the current format", () => {
  it("keeps its months and settings, with the rest filled in", () => {
    const partial = { currency: "EUR", months: { "2026-10": { expenses: [{ id: "x1", name: "Bread", amount: 4.5, category: "Food", date: "2026-10-05" }] } } };
    const d = hydrate(migrate(partial));
    expect(d.currency).toBe("EUR");
    expect(d.months["2026-10"].expenses.map((e) => e.name)).toEqual(["Bread"]);
    expect(d.recurringTemplate).toEqual([]);
  });
});

// A budget exactly as 0.5.2 saved it to budget-ctrl.json, using what that
// version could store: a payday cutoff, a split receipt, a bill every three
// months, rollover budgets, a budget that changed, a period edited after it
// closed, imported entries, import rules, accounts and goals. Before the data model changes (weekly and
// fortnightly pay are next), this proves such a budget still opens intact
// and shows the same figures. Add a file like it for every release that
// changes what is saved.
const SAVED_BY_0_5_2 = JSON.parse(readFileSync("src/fixtures/budget-0.5.2.json", "utf8"));

describe("opening a budget saved by 0.5.2", () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 12, 12)); });
  afterAll(() => vi.useRealTimers());

  const open = () => hydrate(migrate(structuredClone(SAVED_BY_0_5_2)));
  const today = () => new Date(2026, 9, 12, 12);

  it("changes nothing at all", () => {
    expect(open()).toEqual(SAVED_BY_0_5_2);
  });

  it("counts a finished period the same way, split receipt included", () => {
    const d = open();
    const spending = periodSpending(d.months["2026-08"], "2026-08", today(), d.cutoffDay);
    expect(spending.total).toBeCloseTo(5276.34, 2);
    expect(Object.fromEntries(spending.byCategory)).toEqual({
      Groceries: 212.35, Home: 3080, Gifts: 160, Transport: 1450, Fun: 23.99, Health: 350,
    });
    expect(periodIncome(d.months["2026-08"], "2026-08", today(), d.cutoffDay).total).toBeCloseTo(9918.5, 2);
  });

  it("counts the running period only as far as today", () => {
    const d = open();
    // Rent (1 Oct) and Spotify (28 Sep) have landed; the bills due on the
    // 15th and 20th have not.
    expect(periodSpending(d.months["2026-09"], "2026-09", today(), d.cutoffDay).total).toBeCloseTo(2918.09, 2);
  });

  it("keeps what each rollover budget carried, and when a budget changed", () => {
    const d = open();
    const cat = (name) => d.categories.find((c) => c.name === name);
    const fun = envelope(d, cat("Fun"), "2026-09", today(), 87.99);
    expect(fun.carry).toBeCloseTo(276.01, 2);
    expect(fun.left).toBeCloseTo(488.02, 2);
    expect(envelope(d, cat("Gifts"), "2026-09", today(), 0).carry).toBeCloseTo(40, 2);
    expect([capAt(cat("Groceries"), "2026-08"), capAt(cat("Groceries"), "2026-09")]).toEqual([1200, 1400]);
  });

  it("keeps the every-three-months bill on its schedule", () => {
    const t3 = open().recurringTemplate.find((t) => t.id === "t3");
    expect(["2026-08", "2026-09", "2026-10", "2026-11"].map((k) => isOnCycle(t3, k))).toEqual([true, false, false, true]);
  });
});

describe("a new period gets copies of weekly items", () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 3, 12)); });
  afterAll(() => vi.useRealTimers());

  it("one per date it falls on, and monthly items as before", () => {
    const data = hydrate(migrate({
      cutoffDay: 1,
      months: { "2026-10": { income: 3000, expenses: [], recurring: [], upcoming: [], credits: [] } },
      recurringTemplate: [
        { id: "t1", name: "Cleaner", amount: 40, category: "Home", repeat: "weeks", every: 1, startDate: "2026-10-02" },
        { id: "t2", name: "Rent", amount: 1000, category: "Home", dayOfMonth: 1 },
      ],
      creditTemplate: [],
    }));
    const nov = data.months["2026-11"];
    expect(nov.recurring.filter((r) => r.templateId === "t1").map((r) => r.date))
      .toEqual(["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
    expect(nov.recurring.filter((r) => r.templateId === "t2").map((r) => [r.dayOfMonth, r.date])).toEqual([[1, undefined]]);
  });
});

// Moving the payday can make a period the running one before it ever began.
// Entries dated in it move there, but it must still start as a new period
// does: income carried over, and a copy of each bill and credit that falls
// in it. Before, it held only what moved, so income was 0 and every bill
// was missing until added by hand.
describe("changing the payday mid-period", () => {
  const TODAY = new Date(2026, 9, 14, 12);
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(TODAY); });
  afterAll(() => vi.useRealTimers());

  const open = () => hydrate(migrate(structuredClone(SAVED_BY_0_5_2)));
  // Payday 25 → 10 on 14 Oct: the running period becomes 10 Oct – 9 Nov
  // ("2026-10"), and the payments due on 15 and 20 Oct move into it.
  const moveTo10th = () => rebucketData(open(), 10, TODAY).months;

  it("starts the new running period with income and its bills and credits", () => {
    const d = open();
    const oct = moveTo10th()["2026-10"];
    expect(oct.income).toBe(9200);
    // Rent and Spotify; the quarterly car insurance next falls in November.
    expect(oct.recurring.map((r) => [r.templateId, r.dayOfMonth])).toEqual([["t1", 1], ["t2", 28]]);
    expect(oct.credits.map((c) => [c.templateId, c.dayOfMonth])).toEqual([["ct1", 26]]);
    expect(oct.upcoming.map((u) => u.id)).toEqual(["u2", "u3"]);
    expect(oct.expenses).toEqual([]);
    // Nothing for the Recurring tab to offer as "not in this period yet".
    const cal = monthlyCalendar(10);
    expect(d.recurringTemplate.filter((tpl) => missingCopies(tpl, cal, "2026-10", oct.recurring, uid).length)).toEqual([]);
    expect(d.creditTemplate.filter((tpl) => missingCopies(tpl, cal, "2026-10", oct.credits, uid).length)).toEqual([]);
  });

  it("leaves the periods before it as the move made them", () => {
    const saved = SAVED_BY_0_5_2.months;
    const months = moveTo10th();
    const contents = ({ income, expenses, recurring, upcoming, credits }) => ({ income, expenses, recurring, upcoming, credits });
    expect(Object.keys(months)).toEqual(["2026-08", "2026-09", "2026-10"]);
    // The 14 Sep expense now belongs to the period starting 10 Sep.
    expect(contents(months["2026-08"])).toEqual(contents({ ...saved["2026-08"], expenses: saved["2026-08"].expenses.slice(0, 2) }));
    expect(contents(months["2026-09"])).toEqual(contents({ ...saved["2026-09"], expenses: [saved["2026-08"].expenses[2], ...saved["2026-09"].expenses], upcoming: [] }));
  });

  it("leaves a running period that already existed as it was", () => {
    // Payday 25 → 20: 14 Oct is still in "2026-09", now 20 Sep – 19 Oct.
    // Spotify was taken out of it by hand and must not come back.
    const d = open();
    d.months["2026-09"].recurring = d.months["2026-09"].recurring.filter((r) => r.templateId !== "t2");
    const sep = rebucketData(d, 20, TODAY).months["2026-09"];
    expect(sep.income).toBe(9200);
    expect(sep.recurring.map((r) => r.id)).toEqual(["r4"]);
    expect(sep.credits.map((c) => c.id)).toEqual(["c3"]);
  });

  it("keeps a payment due after the running period in it, rather than starting the next period early", () => {
    // Payday 25 → 20: the car service due 20 Oct falls in 20 Oct – 19 Nov,
    // which hasn't begun. Moving it there made that period with only the
    // payment in it, and it then began with income 0 and no bills.
    const d = open();
    expect(countRebucketMoves(d, 20, TODAY)).toBe(0);
    const months = rebucketData(d, 20, TODAY).months;
    expect(Object.keys(months)).toEqual(["2026-08", "2026-09"]);
    expect(months["2026-09"].upcoming.map((u) => u.id)).toEqual(["u2", "u3"]);
  });

  it("moves what's dated after the new running period into it, from a period the move closed", () => {
    // Payday 25 → 10: "2026-09" now ends on 9 Oct. A payment, an expense and
    // a credit dated in mid-November join the running period, 10 Oct – 9 Nov.
    const d = open();
    const sep = d.months["2026-09"];
    sep.upcoming.push({ id: "u4", name: "Tyres", amount: 600, dueDate: "2026-11-12", category: "Transport", paid: false });
    sep.expenses.push({ id: "e7", name: "Concert", amount: 180, date: "2026-11-15", category: "Fun" });
    sep.credits.push({ id: "c4", name: "Deposit back", amount: 500, date: "2026-11-15", category: "Refund" });
    const months = rebucketData(d, 10, TODAY).months;
    expect(Object.keys(months)).toEqual(["2026-08", "2026-09", "2026-10"]);
    const oct = months["2026-10"];
    expect(oct.upcoming.map((u) => u.id)).toEqual(["u2", "u3", "u4"]);
    expect(oct.expenses.map((e) => e.id)).toEqual(["e7"]);
    expect(oct.credits.filter((c) => !c.templateId).map((c) => c.id)).toEqual(["c4"]);
  });

  it("leaves what's in a later period that already exists where it is", () => {
    // An earlier payday change or a statement import can make a period
    // early. Payday 25 → 20 dates the 21 Nov payment in 20 Nov – 19 Dec;
    // it stays in "2026-10" rather than starting that period too.
    const d = open();
    d.months["2026-10"] = { income: 0, expenses: [], recurring: [], credits: [],
      upcoming: [{ id: "u5", name: "Boiler check", amount: 250, dueDate: "2026-11-21", category: "Home", paid: false }] };
    expect(countRebucketMoves(d, 20, TODAY)).toBe(0);
    const months = rebucketData(d, 20, TODAY).months;
    expect(Object.keys(months)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(months["2026-10"].upcoming.map((u) => u.id)).toEqual(["u5"]);
  });

  it("keeps a period's own marks, such as an edit made after it closed", () => {
    expect(moveTo10th()["2026-08"].editedAt).toBe("2026-09-30T08:15:00.000Z");
  });
});

// The 0.5.2 budget as 0.7 saves it after switching to fortnights from Friday
// 2 October 2026: September cut short to 25 Sep - 1 Oct, then fortnights.
const SAVED_FORTNIGHTLY = JSON.parse(readFileSync("src/fixtures/budget-0.7-fortnightly.json", "utf8"));

describe("opening a budget saved after switching to fortnights", () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 12, 12)); });
  afterAll(() => vi.useRealTimers());

  const open = () => hydrate(migrate(structuredClone(SAVED_FORTNIGHTLY)));
  const today = () => new Date(2026, 9, 12, 12);

  it("changes nothing at all", () => {
    expect(open()).toEqual(SAVED_FORTNIGHTLY);
  });

  it("shows the same periods and figures", () => {
    const d = open();
    const cal = calendarFor(d);
    expect(Object.keys(d.months).sort()).toEqual(["2026-08", "2026-09", "2026-10-02"]);
    expect(cal.current(today())).toBe("2026-10-02");
    expect(cal.label("2026-10-02").primary.replace(/\s/g, " ")).toBe("Oct 2 – 15, 2026");
    expect(periodSpending(d.months["2026-10-02"], "2026-10-02", today(), cal).total).toBeCloseTo(106.9, 2);
    expect(periodIncome(d.months["2026-10-02"], "2026-10-02", today(), cal).total).toBe(1900);
    expect(periodSpending(d.months["2026-09"], "2026-09", today(), cal).total).toBeCloseTo(2811.19, 2);
  });
});
