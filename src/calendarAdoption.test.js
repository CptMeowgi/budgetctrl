import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { hydrate, migrate } from "./model.js";
import { monthlyCalendar } from "./lib/calendar.js";
import { periodSpending, periodIncome, creditReceived, categoryAverage } from "./lib/totals.js";
import { periodDays, scheduledItems, forecast, balanceHistory, spendingByDay } from "./lib/forecast.js";
import { allEntries } from "./lib/search.js";
import { collectDueBills } from "./lib/reminders.js";
import { buildReport, rangeKeys, comparisonFor } from "./lib/reports.js";
import { leftOverHistory, goalsMonthlyNeed } from "./lib/goals.js";
import { envelope } from "./lib/envelopes.js";
import { findRegularPayments } from "./lib/regular.js";

// Step 1 of the pay-periods work moves every library onto the period
// calendar. This pins what they produce for a payday-on-the-25th budget, so
// the move is shown to change nothing - and that a calendar and the payday
// number it stands for are interchangeable.
const SAVED = JSON.parse(readFileSync("src/fixtures/budget-0.5.2.json", "utf8"));
const TODAY = new Date(2026, 9, 12, 12);

describe("libraries give the same answers through the calendar", () => {
  let data;
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(TODAY); data = hydrate(migrate(structuredClone(SAVED))); });
  afterAll(() => vi.useRealTimers());

  it("totals: a calendar and its payday number agree", () => {
    const cal = monthlyCalendar(25);
    for (const k of Object.keys(data.months)) {
      const m = data.months[k];
      expect(periodSpending(m, k, TODAY, cal)).toEqual(periodSpending(m, k, TODAY, 25));
      expect(periodIncome(m, k, TODAY, cal)).toEqual(periodIncome(m, k, TODAY, 25));
      for (const c of m.credits) expect(creditReceived(c, k, TODAY, cal)).toBe(creditReceived(c, k, TODAY, 25));
    }
    expect(periodDays("2026-09", cal)).toEqual(periodDays("2026-09", 25));
  });

  it("everything built from the budget is unchanged", () => {
    const snapshot = JSON.stringify({
      scheduled: scheduledItems(data, "2026-09", TODAY),
      forecast: forecast(data, "2026-09", TODAY),
      balance: balanceHistory(data, "2026-09", TODAY),
      byDay: spendingByDay(data, "2026-09", TODAY),
      entries: allEntries(data).map((e) => [e.kind, e.entry.id, e.periodKey, e.date]),
      due: collectDueBills(data, TODAY, 7),
      keys: rangeKeys(data, "last:3", "2026-09"),
      comparison: comparisonFor(data, "last:3", "2026-09"),
      report: buildReport(data, ["2026-08", "2026-09"], TODAY, { runningKey: "2026-09" }),
      history: leftOverHistory(data, TODAY),
      need: goalsMonthlyNeed(data.goals, data, TODAY),
      fun: envelope(data, data.categories.find((c) => c.name === "Fun"), "2026-09", TODAY, 87.99),
      average: categoryAverage(data, "Groceries", "2026-09", TODAY),
      regular: findRegularPayments(data, TODAY),
    });
    expect(snapshot).toMatchSnapshot();
  });
});
