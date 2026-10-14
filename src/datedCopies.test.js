import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { periodSpending, periodIncome, creditReceived } from "./lib/totals.js";
import { scheduledItems } from "./lib/forecast.js";
import { allEntries } from "./lib/search.js";
import { collectDueBills } from "./lib/reminders.js";
import { analyzeImport } from "./lib/importer.js";
import { budgetToRows } from "./lib/csv.js";
import { countRebucketMoves, rebucketData } from "./model.js";
import { isRecurringItem, isWeekly } from "./lib/occurrences.js";
import { isoDay, itemDateInPeriod } from "./lib/periods.js";

// A bill every week and a credit every two weeks, as copies dated in
// October beside a monthly rent. Every part of the app that reads a period
// must see each copy on its own date.
const weekly = { repeat: "weeks", every: 1, startDate: "2026-10-02" };
const fortnightly = { repeat: "weeks", every: 2, startDate: "2026-10-03" };
const budget = () => ({
  cutoffDay: 1,
  months: {
    "2026-10": {
      income: 3000,
      expenses: [],
      recurring: [
        { id: "m1", name: "Rent", amount: 1000, dayOfMonth: 1, category: "Home", templateId: "tm" },
        { id: "w1", name: "Cleaner", amount: 40, category: "Home", ...weekly, date: "2026-10-09", templateId: "tw" },
        { id: "w2", name: "Cleaner", amount: 40, category: "Home", ...weekly, date: "2026-10-16", templateId: "tw" },
      ],
      upcoming: [],
      credits: [
        { id: "c1", name: "Pocket money", amount: 20, category: "Gift", ...fortnightly, date: "2026-10-03", templateId: "tc" },
        { id: "c2", name: "Pocket money", amount: 20, category: "Gift", ...fortnightly, date: "2026-10-17", templateId: "tc" },
      ],
    },
  },
  recurringTemplate: [],
  creditTemplate: [],
  categories: [{ name: "Home" }, { name: "Uncategorized" }],
  creditCategories: [{ name: "Gift" }, { name: "Other" }],
});
const TODAY = new Date(2026, 9, 12, 12); // Monday 12 October

describe("dated copies of weekly items", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(TODAY); });
  afterAll(() => vi.useRealTimers());

  it("know which items repeat", () => {
    const m = budget().months["2026-10"];
    expect(m.recurring.map(isRecurringItem)).toEqual([true, true, true]);
    expect(m.recurring.map(isWeekly)).toEqual([false, true, true]);
    expect(isRecurringItem({ name: "Refund", amount: 5, date: "2026-10-04" })).toBe(false);
  });

  it("count a copy as spent once its own date has passed", () => {
    const s = periodSpending(budget().months["2026-10"], "2026-10", TODAY, 1);
    expect(s.recurring).toBe(1040); // rent and the 9 Oct cleaner; not the 16th yet
  });

  it("count a credit copy as received on its own date", () => {
    const m = budget().months["2026-10"];
    expect(m.credits.map((c) => creditReceived(c, "2026-10", TODAY, 1))).toEqual([true, false]);
    const inc = periodIncome(m, "2026-10", TODAY, 1);
    expect([inc.credits, inc.pending]).toEqual([20, 20]);
  });

  it("show each copy on its own date in the forecast and bill calendar", () => {
    const items = scheduledItems(budget(), "2026-10", TODAY).map((i) => [i.id, i.date, i.status]);
    expect(items).toEqual([
      ["m1", "2026-10-01", "done"],
      ["c1", "2026-10-03", "done"],
      ["w1", "2026-10-09", "done"],
      ["w2", "2026-10-16", "due"],
      ["c2", "2026-10-17", "due"],
    ]);
  });

  it("find each copy by its own date in search", () => {
    const dates = Object.fromEntries(allEntries(budget()).map((e) => [e.entry.id, e.date]));
    expect(dates).toMatchObject({ m1: "2026-10-01", w1: "2026-10-09", w2: "2026-10-16", c1: "2026-10-03", c2: "2026-10-17" });
  });

  it("remind about the next copy", () => {
    const due = collectDueBills(budget(), TODAY, 7).filter((b) => b.kind === "recurring").map((b) => [b.entryId, b.dueISO, b.inDays]);
    expect(due).toEqual([["w2", "2026-10-16", 4]]);
  });

  it("import: match two payments of the same weekly bill to their own copies", () => {
    const rows = analyzeImport([
      { date: "2026-10-09", name: "CLEANER", note: "", amount: -40 },
      { date: "2026-10-16", name: "CLEANER", note: "", amount: -40 },
      { date: "2026-10-17", name: "POCKET MONEY", note: "", amount: 20 },
    ], budget());
    expect(rows.map((r) => r.action)).toEqual(["skip", "skip", "skip"]);
  });

  it("export each copy with its own date", () => {
    // Monthly copies still get their date from the app's resolver; rows come out by date.
    const resolveRecurringDate = (day, period) => `${period}-${String(day).padStart(2, "0")}`;
    const rows = budgetToRows(budget(), { resolveRecurringDate });
    expect(rows.filter((r) => r.type.startsWith("Recurring")).map((r) => [r.name, r.date, r.type])).toEqual([
      ["Rent", "2026-10-01", "Recurring"],
      ["Pocket money", "2026-10-03", "Recurring credit"],
      ["Cleaner", "2026-10-09", "Recurring"],
      ["Cleaner", "2026-10-16", "Recurring"],
      ["Pocket money", "2026-10-17", "Recurring credit"],
    ]);
  });

  it("payday changes: move with their dates, while monthly copies stay", () => {
    // Payday 1 → 10: period 2026-10 now starts on 10 Oct, so the 3 Oct
    // credit and the 9 Oct cleaner belong to 2026-09.
    expect(countRebucketMoves(budget(), 10)).toBe(2);
    const out = rebucketData(budget(), 10).months;
    expect(out["2026-09"].recurring.map((r) => r.id)).toEqual(["w1"]);
    expect(out["2026-09"].credits.map((c) => c.id)).toEqual(["c1"]);
    expect(out["2026-10"].recurring.map((r) => r.id)).toEqual(["m1", "w2"]);
    expect(out["2026-10"].credits.map((c) => c.id)).toEqual(["c2"]);
  });

  it("stray date: a monthly copy still falls on its day of the month", () => {
    expect(isoDay(itemDateInPeriod({ dayOfMonth: 5, date: "2026-10-20" }, "2026-10", 1))).toBe("2026-10-05");
    expect(isoDay(itemDateInPeriod({ repeat: "weeks", date: "2026-10-20" }, "2026-10", 1))).toBe("2026-10-20");
  });
});
