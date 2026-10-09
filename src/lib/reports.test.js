import { describe, it, expect } from "vitest";
import {
  spanLabel, rangeOptions, rangeKeys, comparisonFor, buildReport, categoryChanges, payeeKey, reportToCsv, percentChange, BASE_INCOME_NAME,
} from "./reports.js";
import { periodSpending } from "./totals.js";

const D = (y, m, d) => new Date(y, m - 1, d);
const TODAY = D(2026, 10, 9);
const CUR = "2026-10";

const food = (name, amount) => ({ name, amount, category: "Food" });
const rent = { name: "Rent", amount: 2000, category: "Home", dayOfMonth: 1 };
const month = (income, expenses = [], recurring = [], upcoming = [], credits = []) => ({ income, expenses, recurring, upcoming, credits });

const data = {
  cutoffDay: 1,
  months: {
    "2025-08": month(7000, [food("BIEDRONKA 1234 WARSZAWA", 400)]),
    "2025-09": month(7000, [food("Biedronka 5 Warszawa", 500)]),
    "2026-07": month(8000, [food("Biedronka 77 Warszawa", 600)], [rent], [],
      [{ name: "Bonus", amount: 1000, category: "Bonus", date: "2026-07-15" }]),
    "2026-08": month(8000, [food("BIEDRONKA 1234 WARSZAWA", 800)], [rent],
      [{ name: "Dentist", amount: 300, category: "Health", dueDate: "2026-08-12", paid: true }]),
    "2026-09": month(8000, [food("Biedronka 5 Warszawa", 400)], [rent]),
    "2026-10": month(8000, [food("Biedronka 77 Warszawa", 120)], [rent]),
    "2026-11": month(8000, [food("Planned", 50)]),
  },
};

describe("rangeOptions", () => {
  const ids = rangeOptions(data, CUR).map((o) => o.id);

  it("offers each year with data, newest first, then rolling windows", () => {
    expect(ids).toEqual(["year:2026", "year:2025", "last:3", "last:6", "all"]);
  });

  it("names the current year as such", () => {
    expect(rangeOptions(data, CUR)[0].label).toBe("This year (2026)");
  });

  it("does not offer a window longer than the history (5 closed months here)", () => {
    expect(ids).not.toContain("last:12");
  });

  it("speaks of periods, not months, when a custom start day is set", () => {
    const labels = rangeOptions({ ...data, cutoffDay: 25 }, CUR).map((o) => o.label);
    expect(labels).toContain("Last 3 periods");
  });
});

describe("rangeKeys", () => {
  it("covers a calendar year, without future periods", () => {
    expect(rangeKeys(data, "year:2026", CUR)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("leaves the running period out of a rolling window", () => {
    expect(rangeKeys(data, "last:3", CUR)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("skips periods with no data rather than counting them as zero", () => {
    expect(rangeKeys(data, "last:6", CUR)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("takes everything up to now for all time", () => {
    expect(rangeKeys(data, "all", CUR)).toHaveLength(6);
  });

  it("is empty for a range it does not understand", () => {
    expect(rangeKeys(data, "bogus", CUR)).toEqual([]);
  });
});

describe("comparisonFor", () => {
  it("compares a year against the same completed periods a year earlier", () => {
    const c = comparisonFor(data, "year:2026", CUR);
    expect(c.closed).toEqual(["2026-07", "2026-08", "2026-09"]); // October still running
    expect(c.keys).toEqual(["2025-08", "2025-09"]);              // July 2025 was never tracked
    expect(c.label).toBe("Aug–Sep 2025"); // not "2025": most of it was never tracked
  });

  it("names just the year when the earlier year is fully there", () => {
    const full = { ...data, months: { ...data.months, "2025-07": month(7000) } };
    expect(comparisonFor(full, "year:2026", CUR).label).toBe("2025");
  });

  it("names the months when a rolling window's earlier stretch is partly tracked", () => {
    const c = comparisonFor(data, "last:12", CUR);
    expect(c.keys).toEqual(["2025-08", "2025-09"]);
    expect(c.label).toBe("Aug–Sep 2025");
  });

  it("calls a fully tracked earlier window by its length", () => {
    const more = { ...data, months: { ...data.months, "2026-04": month(8000), "2026-05": month(8000), "2026-06": month(8000) } };
    expect(comparisonFor(more, "last:3", CUR).label).toBe("the 3 months before");
  });

  it("has nothing to compare when the earlier window holds no data", () => {
    expect(comparisonFor(data, "last:3", CUR)).toBe(null);
  });

  it("does not compare all time", () => {
    expect(comparisonFor(data, "all", CUR)).toBe(null);
  });
});

describe("buildReport", () => {
  const keys = rangeKeys(data, "year:2026", CUR);
  const r = buildReport(data, keys, TODAY);

  it("totals income and spending the way the Dashboard does", () => {
    const viaTotals = keys.reduce((a, k) => a + periodSpending(data.months[k], k, TODAY, 1).total, 0);
    expect(r.spent).toBe(viaTotals);
    expect(r.spent).toBe(2600 + 3100 + 2400 + 2120);
    expect(r.income).toBe(4 * 8000 + 1000);
    expect(r.saved).toBe(r.income - r.spent);
    expect(r.savingsRate).toBeCloseTo((33000 - 10220) / 33000);
  });

  it("has categories that add up to the total, biggest first", () => {
    expect(r.categories.map((c) => c.name)).toEqual(["Home", "Food", "Health"]);
    expect(r.categories.reduce((a, c) => a + c.total, 0)).toBe(r.spent);
  });

  it("lays each category out period by period", () => {
    const foodRow = r.categories.find((c) => c.name === "Food");
    expect(foodRow.perPeriod).toEqual([600, 800, 400, 120]);
    expect(foodRow.average).toBe(1920 / 4);
    expect(r.categories.find((c) => c.name === "Health").perPeriod).toEqual([0, 300, 0, 0]);
  });

  it("lists the biggest one-off payments, paid Upcoming included, recurring bills not", () => {
    expect(r.biggest.map((b) => b.entry.amount)).toEqual([800, 600, 400, 300, 120]);
    expect(r.biggest.some((b) => b.kind === "recurring")).toBe(false);
    expect(r.biggest[0].periodKey).toBe("2026-08");
  });

  it("groups one shop across store numbers and capitalisation", () => {
    const shop = r.payees.find((p) => p.key === "biedronka warszawa");
    expect(shop.total).toBe(1920);
    expect(shop.count).toBe(4);
    expect(shop.name).toBe("Biedronka 77 Warszawa"); // the spelling seen most often
    expect(r.payees[0].name).toBe("Rent");
  });

  it("splits income into base income and each credit source", () => {
    expect(r.incomeSources).toEqual([
      { name: BASE_INCOME_NAME, value: 32000 },
      { name: "Bonus", value: 1000 },
    ]);
  });

  it("averages over completed periods, leaving the running one out", () => {
    const running = buildReport(data, keys, TODAY, { runningKey: CUR });
    expect(running.spent).toBe(r.spent);                        // totals unchanged
    expect(running.averagedOver).toBe(3);
    expect(running.averageSpent).toBe((2600 + 3100 + 2400) / 3);
    expect(running.categories.find((c) => c.name === "Food").average).toBe((600 + 800 + 400) / 3);
  });

  it("still averages when the running period is all there is", () => {
    const only = buildReport(data, [CUR], TODAY, { runningKey: CUR });
    expect(only.averageSpent).toBe(2120);
  });

  it("is empty but well formed for no periods", () => {
    const empty = buildReport(data, [], TODAY);
    expect(empty.spent).toBe(0);
    expect(empty.savingsRate).toBe(null);
    expect(empty.categories).toEqual([]);
  });
});

describe("categoryChanges", () => {
  it("compares per-period averages, biggest move first", () => {
    const c = comparisonFor(data, "year:2026", CUR);
    const changes = categoryChanges(buildReport(data, c.closed, TODAY), buildReport(data, c.keys, TODAY));
    expect(changes.map((x) => x.name)).toEqual(["Home", "Food", "Health"]);
    const foodChange = changes.find((x) => x.name === "Food");
    expect(foodChange.now).toBe(600);     // (600 + 800 + 400) / 3
    expect(foodChange.before).toBe(450);  // (400 + 500) / 2
    expect(foodChange.pct).toBeCloseTo(1 / 3);
    expect(changes[0].pct).toBe(null);    // nothing on rent before: no percentage to give
  });
});

describe("percentChange", () => {
  it("is null without a base to compare against", () => {
    expect(percentChange(5, 0)).toBe(null);
    expect(percentChange(150, 100)).toBeCloseTo(0.5);
  });
});

describe("payeeKey", () => {
  it("ignores digits, punctuation and case", () => {
    expect(payeeKey("ŻABKA Z1234 K.1 WARSZAWA")).toBe(payeeKey("Żabka z77 k 9 Warszawa"));
  });

  it("keeps a name made only of digits rather than dropping it", () => {
    expect(payeeKey("12345")).toBe("12345");
  });
});

describe("reportToCsv", () => {
  const r = buildReport(data, rangeKeys(data, "year:2026", CUR), TODAY);

  it("writes the decimal comma and ; separator for a Polish reader", () => {
    const csv = reportToCsv(r, { locale: "pl-PL" });
    const lines = csv.replace("\uFEFF", "").split("\r\n");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(lines[0]).toBe("Category;2026-07;2026-08;2026-09;2026-10;Total;Average");
    expect(lines[1]).toBe("Home;2000,00;2000,00;2000,00;2000,00;8000,00;2000,00");
    expect(lines).toContain("Total spent;2600,00;3100,00;2400,00;2120,00;10220,00;2555,00");
  });

  it("uses the given period labels", () => {
    const csv = reportToCsv(r, { locale: "en-US", label: (k) => `P${k.slice(5)}` });
    expect(csv.split("\r\n")[0]).toBe("\uFEFFCategory,P07,P08,P09,P10,Total,Average");
  });

  it("neutralises a category name that would run as a spreadsheet formula", () => {
    const evil = { ...data, months: { [CUR]: month(0, [{ name: "x", amount: 1, category: "=HYPERLINK(1)" }]) } };
    const csv = reportToCsv(buildReport(evil, [CUR], TODAY), { locale: "en-US" });
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});

describe("spanLabel", () => {
  it("writes the shortest unambiguous span", () => {
    expect(spanLabel(["2025-03"])).toBe("Mar 2025");
    expect(spanLabel(["2025-08", "2025-09"])).toBe("Aug–Sep 2025");
    expect(spanLabel(["2024-11", "2025-02"])).toBe("Nov 2024–Feb 2025");
  });
});
