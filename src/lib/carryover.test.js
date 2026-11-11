import { describe, it, expect } from "vitest";
import { splitPeriod, carryChain, carriedInto } from "./carryover.js";
import { leftOverHistory } from "./goals.js";
import { fundHistory, fundTotals, sinkingFunds } from "./sinking.js";
import { carryInto } from "./envelopes.js";
import { calendarFor } from "./calendar.js";
import { periodIncome, periodSpending } from "./totals.js";
import { perPeriodOf } from "./setAside.js";
import { setAsideAt } from "./setAsideHistory.js";

// All synthetic. Paid on the 1st; carrying starts with October 2026.
const D = (y, m, d) => new Date(y, m - 1, d, 12);
const EARLIEST = "0000-00";
let n = 0;
const spend = (amount, category = "Food") => ({ id: `e${++n}`, name: category, amount, category });
const month = (income, ...spent) => ({
  income, expenses: spent.map((a) => (typeof a === "number" ? spend(a) : a)), recurring: [], upcoming: [], credits: [],
});
const budget = (months, extra = {}) => ({
  cutoffDay: 1,
  savingsGoal: { monthly: 200, history: [{ from: EARLIEST, monthly: 200 }] },
  carry: { on: true, from: "2026-10" },
  months,
  ...extra,
});
const entry = (carriedIn, setAsideApplied, billsSaved, billsPaid, carriedOut) =>
  ({ carriedIn, setAsideApplied, billsSaved, billsPaid, carriedOut });
const row = (data, today, key) => leftOverHistory(data, today).series.find((r) => r.key === key);

// A TV licence, 600 a year, due 10 March: saving from October is 100 a month.
const tv = (from = "2026-10") => ({
  id: "tv", name: "TV licence", amount: 600, dayOfMonth: 10, every: 12, anchor: "2026-03", category: "Bills", saveUp: { from },
});
// Water, 300 a quarter on the 15th (September, December, March): saving
// from October is 100 a month.
const water = { id: "wat", name: "Water", amount: 300, dayOfMonth: 15, every: 3, anchor: "2026-09", category: "Bills", saveUp: { from: "2026-10" } };
const waterBill = () => ({ id: `w${++n}`, name: "Water", amount: 300, dayOfMonth: 15, every: 3, anchor: "2026-09", category: "Bills", templateId: "wat" });

// Income less spending, plus bills paid from savings, less the set-aside and
// the bill savings, over the chain: what the last period carried out.
const sums = (data, today) => {
  const cal = calendarFor(data);
  let total = 0;
  for (const [k, e] of carryChain(data, today)) {
    const m = data.months[k];
    total += periodIncome(m, k, today, cal).total - periodSpending(m, k, today, cal).total
      + e.billsPaid - e.setAsideApplied - e.billsSaved;
  }
  return Math.round(total * 100) / 100;
};

describe("splitPeriod", () => {
  it("sets aside first, then saves for bills, and carries the rest", () => {
    expect(splitPeriod({ carriedIn: 0, income: 5000, spent: 4100, paidFromFund: 0, setAside: 200, billsWanted: 100 }))
      .toEqual({ available: 900, setAsideApplied: 200, billsSaved: 100, carriedOut: 600 });
  });

  it("counts money carried in and bills paid from savings", () => {
    expect(splitPeriod({ carriedIn: 700, income: 5000, spent: 5300, paidFromFund: 100, setAside: 200, billsWanted: 50 }))
      .toEqual({ available: 500, setAsideApplied: 200, billsSaved: 50, carriedOut: 250 });
  });

  it("sets nothing aside from a minus, and carries it", () => {
    expect(splitPeriod({ carriedIn: 0, income: 5000, spent: 5150, paidFromFund: 0, setAside: 200, billsWanted: 100 }))
      .toEqual({ available: -150, setAsideApplied: 0, billsSaved: 0, carriedOut: -150 });
  });

  it("sets aside only what a lean period has", () => {
    expect(splitPeriod({ carriedIn: 0, income: 5000, spent: 4880, paidFromFund: 0, setAside: 200, billsWanted: 100 }))
      .toEqual({ available: 120, setAsideApplied: 120, billsSaved: 0, carriedOut: 0 });
  });
});

describe("carryChain", () => {
  const NOV_10 = D(2026, 11, 10);
  const example = (oct = month(5000, 4100), extra) =>
    budget({ "2026-09": month(4000, 3000), "2026-10": oct, "2026-11": month(5000) }, extra);

  it("the user's example: October carries 700 after its set-aside of 200", () => {
    const d = example();
    expect([...carryChain(d, NOV_10)]).toEqual([["2026-10", entry(0, 200, 0, 0, 700)]]);
    expect(carriedInto(d, "2026-11", NOV_10)).toBe(700);
    expect(row(d, NOV_10, "2026-10")).toMatchObject({ delta: 200, carried: 700, setAsideWanted: 200 });
  });

  it("carries a minus, and sets nothing aside", () => {
    const d = example(month(5000, 5150));
    expect(carryChain(d, NOV_10).get("2026-10")).toEqual(entry(0, 0, 0, 0, -150));
    expect(carriedInto(d, "2026-11", NOV_10)).toBe(-150);
    expect(row(d, NOV_10, "2026-10")).toMatchObject({ delta: 0, carried: -150, setAsideWanted: 200 });
  });

  it("a lean month sets aside what it has and carries nothing", () => {
    const d = example(month(5000, 4880));
    expect(carryChain(d, NOV_10).get("2026-10")).toEqual(entry(0, 120, 0, 0, 0));
    expect(row(d, NOV_10, "2026-10")).toMatchObject({ delta: 120, carried: 0, setAsideWanted: 200 });
  });

  it("chains from one period into the next, into January", () => {
    const d = budget({
      "2026-10": month(5000, 4100), "2026-11": month(5000, 5300), "2026-12": month(5000, 4800), "2027-01": month(5000),
    });
    const JAN_10 = D(2027, 1, 10);
    // November: 700 + 5000 - 5300 is 400; 200 set aside, 200 carried.
    expect([...carryChain(d, JAN_10)]).toEqual([
      ["2026-10", entry(0, 200, 0, 0, 700)],
      ["2026-11", entry(700, 200, 0, 0, 200)],
      ["2026-12", entry(200, 200, 0, 0, 200)],
    ]);
    expect(carriedInto(d, "2026-11", JAN_10)).toBe(700);
    expect(carriedInto(d, "2026-12", JAN_10)).toBe(200);
    expect(carriedInto(d, "2027-01", JAN_10)).toBe(200);
  });

  it("leaves out the running period and anything after it", () => {
    const d = budget({ "2026-10": month(5000, 4100), "2026-11": month(5000), "2026-12": month(9000) });
    expect([...carryChain(d, NOV_10).keys()]).toEqual(["2026-10"]);
  });

  it("follows an edit to a closed period", () => {
    const d = example();
    expect(carriedInto(d, "2026-11", NOV_10)).toBe(700);
    d.months["2026-10"].expenses.push(spend(50));
    expect(carriedInto(d, "2026-11", NOV_10)).toBe(650);
  });

  it("isn't changed by a later set-aside change, or a bill added later", () => {
    const later = example(undefined, {
      savingsGoal: { monthly: 500, history: [{ from: EARLIEST, monthly: 200 }, { from: "2026-11", monthly: 500 }] },
    });
    expect(carryChain(later, NOV_10).get("2026-10")).toEqual(entry(0, 200, 0, 0, 700));
    const billed = example(undefined, { recurringTemplate: [tv("2026-11")] });
    expect(carryChain(billed, NOV_10).get("2026-10")).toEqual(entry(0, 200, 0, 0, 700));
    expect(carriedInto(billed, "2026-11", NOV_10)).toBe(700);
  });

  it("walks a switch from monthly to fortnightly in date order, and nothing vanishes", () => {
    // October runs on to 5 November; fortnights from 6 November. 200 a month
    // is 92 a fortnight. The TV licence is due in the fortnight from 26 Feb:
    // ten periods from October, 60 each.
    const months = {};
    months["2026-11-20"] = month(2300, 2500);
    months["2026-10"] = month(5000, 4100);
    months["2026-12-04"] = month(2300);
    months["2026-11-06"] = month(2300, 2000);
    const d = budget(months, {
      paySchedule: [{ kind: "monthly", cutoffDay: 1 }, { kind: "weeks", every: 2, from: "2026-11-06", after: "2026-10-01" }],
      recurringTemplate: [tv()],
    });
    const DEC_10 = D(2026, 12, 10);
    expect([...carryChain(d, DEC_10)]).toEqual([
      ["2026-10", entry(0, 200, 60, 0, 640)],
      ["2026-11-06", entry(640, 92, 60, 0, 788)],
      ["2026-11-20", entry(788, 92, 60, 0, 436)],
    ]);
    expect(sums(d, DEC_10)).toBe(436);
    expect(carriedInto(d, "2026-12-04", DEC_10)).toBe(436);
  });

  it("carries past a month with no record", () => {
    // The app wasn't opened in November or December: no keys, no set-aside
    // taken from the carried money.
    const d = budget({ "2026-10": month(5000, 4100), "2027-01": month(5000) });
    const JAN_10 = D(2027, 1, 10);
    expect([...carryChain(d, JAN_10).keys()]).toEqual(["2026-10"]);
    expect(carriedInto(d, "2026-12", JAN_10)).toBe(700);
    expect(carriedInto(d, "2027-01", JAN_10)).toBe(700);
  });

  it("is empty with carrying off, or never set", () => {
    const off = example(undefined, { carry: { on: false, from: "2026-10" } });
    expect(carryChain(off, NOV_10).size).toBe(0);
    expect(carriedInto(off, "2026-11", NOV_10)).toBe(0);
    const { carry: _none, ...never } = example();
    expect(carryChain(never, NOV_10).size).toBe(0);
    expect(carriedInto(never, "2026-11", NOV_10)).toBe(0);
  });

  it("keeps the carry to the cent, with no float dust and no -0", () => {
    // 0.1 + 0.2 spent of 0.3 is a hair over in floating point.
    const d = budget({ "2026-10": month(0.3, 0.1, 0.2), "2026-11": month(5000) });
    expect(carryChain(d, NOV_10).get("2026-10").carriedOut).toBe(0);
    expect(carriedInto(d, "2026-11", NOV_10)).toBe(0);
  });

  it("carries nothing into the start or anything before it", () => {
    const d = example();
    expect(carriedInto(d, "2026-10", NOV_10)).toBe(0);
    expect(carriedInto(d, "2026-09", NOV_10)).toBe(0);
  });
});

describe("carrying and bill savings", () => {
  it("saves a bill's share after the set-aside, so carries that much less", () => {
    const d = budget({ "2026-10": month(5000, 4100), "2026-11": month(5000) }, { recurringTemplate: [tv()] });
    const NOV_10 = D(2026, 11, 10);
    expect(carryChain(d, NOV_10).get("2026-10")).toEqual(entry(0, 200, 100, 0, 600));
    expect(fundHistory(d, NOV_10).get("2026-10")).toEqual({ saved: 100, paid: 0 });
    expect(carriedInto(d, "2026-11", NOV_10)).toBe(600);
  });

  it("a bill paid from its savings doesn't lower that period's carry", () => {
    // October and November each put 100 towards the water bill; December
    // pays it, 200 of the 300 from what was saved.
    const dec = month(5000, 4100);
    dec.recurring = [waterBill()];
    const d = budget({ "2026-10": month(5000, 4100), "2026-11": month(5000, 4100), "2026-12": dec, "2027-01": month(5000) },
      { recurringTemplate: [water] });
    const chain = carryChain(d, D(2027, 1, 10));
    expect([...chain]).toEqual([
      ["2026-10", entry(0, 200, 100, 0, 600)],
      ["2026-11", entry(600, 200, 100, 0, 1200)],
      ["2026-12", entry(1200, 200, 0, 200, 1800)],
    ]);
    // Each month adds 600: December's own 100 of the bill, like the others.
    expect([...chain.values()].map((e) => e.carriedOut - e.carriedIn)).toEqual([600, 600, 600]);
  });

  it("saves nothing for bills from a minus carried in", () => {
    // October goes 300 over; November's own 300 only brings it back to 0.
    const d = budget({ "2026-10": month(5000, 5300), "2026-11": month(5000, 4700), "2026-12": month(5000) },
      { recurringTemplate: [tv()] });
    const DEC_10 = D(2026, 12, 10);
    expect(carryChain(d, DEC_10).get("2026-11")).toEqual(entry(-300, 0, 0, 0, 0));
    expect(fundHistory(d, DEC_10).size).toBe(0);
    const [f] = sinkingFunds(d, DEC_10);
    expect([f.saved, f.thisPeriod]).toEqual([0, 150]);
  });

  it("nothing vanishes: what came in and went out adds up to the last carry", () => {
    const dec = month(5000, 4100);
    dec.recurring = [waterBill()];
    const d = budget({ "2026-10": month(5000, 4100), "2026-11": month(5000, 5800), "2026-12": dec, "2027-01": month(5000) },
      { recurringTemplate: [water] });
    const JAN_10 = D(2027, 1, 10);
    // 15000 in, 14300 out, 100 paid from savings, 400 set aside, 100 saved.
    expect([...carryChain(d, JAN_10)]).toEqual([
      ["2026-10", entry(0, 200, 100, 0, 600)],
      ["2026-11", entry(600, 0, 0, 0, -200)],
      ["2026-12", entry(-200, 200, 0, 100, 300)],
    ]);
    expect(sums(d, JAN_10)).toBe(300);
  });
});

describe("starting fresh", () => {
  const fresh = (resets, last) => {
    const months = {};
    for (const k of ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]) {
      if (k <= last) months[k] = month(5000, 4100);
    }
    return budget(months, { carry: { on: true, from: "2026-10", resets } });
  };
  const JAN_10 = D(2027, 1, 10);

  it("starts a listed period at 0 and carries on from it", () => {
    const d = fresh(["2026-12"], "2027-01");
    expect([...carryChain(d, JAN_10)]).toEqual([
      ["2026-10", entry(0, 200, 0, 0, 700)],
      ["2026-11", entry(700, 200, 0, 0, 1400)],
      ["2026-12", entry(0, 200, 0, 0, 700)],
    ]);
    expect(carriedInto(d, "2026-12", JAN_10)).toBe(0);
    expect(carriedInto(d, "2027-01", JAN_10)).toBe(700);
    // October and November's savings rows are as without the reset.
    const plain = fresh([], "2027-01");
    for (const k of ["2026-10", "2026-11"]) expect(row(d, JAN_10, k)).toEqual(row(plain, JAN_10, k));
    expect(row(d, JAN_10, "2026-11")).toMatchObject({ delta: 200, carried: 1400 });
  });

  it("starts the next recorded period at 0 when the listed one has no record", () => {
    const d = fresh(["2026-12"], "2027-02");
    delete d.months["2026-12"];
    const FEB_10 = D(2027, 2, 10);
    expect(carryChain(d, FEB_10).get("2027-01")).toEqual(entry(0, 200, 0, 0, 700));
    expect(carriedInto(d, "2026-12", FEB_10)).toBe(0);
    expect(carriedInto(d, "2027-02", FEB_10)).toBe(700);
  });

  it("starts the running period at 0 when it's listed", () => {
    const d = fresh(["2027-01"], "2027-01");
    expect(carriedInto(d, "2027-01", JAN_10)).toBe(0);
  });

  it("keeps an earlier reset when another is added", () => {
    const d = fresh(["2026-12", "2027-02"], "2027-03");
    const MAR_10 = D(2027, 3, 10);
    const chain = carryChain(d, MAR_10);
    expect(chain.get("2026-12")).toEqual(entry(0, 200, 0, 0, 700));
    expect(chain.get("2027-01")).toEqual(entry(700, 200, 0, 0, 1400));
    expect(chain.get("2027-02")).toEqual(entry(0, 200, 0, 0, 700));
    expect(carriedInto(d, "2027-03", MAR_10)).toBe(700);
  });
});

describe("carrying and category budgets that roll over", () => {
  it("counts a rolling category's unspent budget once, in income less spending", () => {
    // Gifts has 500 a month and spent 300: its next budget gains 200, and that
    // 200 is already in what October carries.
    const gifts = { name: "Gifts", cap: 500, rollover: { from: "2026-10" } };
    const d = budget({ "2026-10": month(5000, spend(300, "Gifts"), spend(3800)), "2026-11": month(5000) },
      { categories: [gifts, { name: "Food" }] });
    const NOV_10 = D(2026, 11, 10);
    expect(carryInto(d, gifts, "2026-11", NOV_10)).toBe(200);
    expect(carriedInto(d, "2026-11", NOV_10)).toBe(700);
    const noRollover = { ...d, categories: [{ name: "Gifts", cap: 500 }, { name: "Food" }] };
    expect(carriedInto(noRollover, "2026-11", NOV_10)).toBe(700);
  });
});

// ---------------------------------------------------------------------------
// The figures 0.8.0 gave. Every literal below was produced by the 0.8.0 code
// (git archive 0.8.0) on this same budget, and the first rows checked by hand.

const insurance = { id: "ins", name: "Car insurance", amount: 1200, dayOfMonth: 10, every: 12, anchor: "2026-03", category: "Bills", saveUp: { from: "2026-04" } };
const quarterly = { id: "q", name: "Water", amount: 300, dayOfMonth: 15, every: 3, anchor: "2026-06", category: "Bills", saveUp: { from: "2026-07" } };
const quarterlyBill = () => ({ id: `q${++n}`, name: "Water", amount: 300, dayOfMonth: 15, every: 3, anchor: "2026-06", category: "Bills", templateId: "q" });

// Saving for two bills since spring, with a set-aside of 300; carrying from
// October; today is 10 January 2027.
const frozen = (extra = {}) => {
  const months = {
    "2026-04": month(4000, 3000),
    "2026-05": month(4000, 3900),
    "2026-06": month(4000, 4300),
    "2026-07": month(4200, 3100),
    "2026-08": month(4200, 3500),
    "2026-09": month(4200, 3200),
    "2026-10": month(5000, 4100),
    "2026-11": month(5000, 5300),
    "2026-12": month(5000, 4000),
    "2027-01": month(5000, 4500),
  };
  months["2026-09"].recurring = [quarterlyBill()];
  months["2026-12"].recurring = [quarterlyBill()];
  return {
    cutoffDay: 1,
    savingsGoal: { monthly: 300, history: [{ from: EARLIEST, monthly: 300 }] },
    recurringTemplate: [insurance, quarterly],
    carry: { on: true, from: "2026-10" },
    months,
    ...extra,
  };
};
const JAN_10 = D(2027, 1, 10);

// 0.8.0's leftOverHistory rows. April: 1000 left, 100 to the insurance.
// July: 800 after the set-aside, 100 to water and 1100/9 to the insurance.
const ROWS_080 = [
  { key: "start", label: "Start", balance: 0, delta: 0, income: 0, spent: 0 },
  { key: "2026-04", label: "Apr", balance: 900, delta: 900, income: 4000, spent: 3000, editedAt: null, forBills: 100, bills: { saved: 100, paid: 0 } },
  { key: "2026-05", label: "May", balance: 1000, delta: 100, income: 4000, spent: 3900, editedAt: null },
  { key: "2026-06", label: "Jun", balance: 700, delta: -300, income: 4000, spent: 4300, editedAt: null },
  { key: "2026-07", label: "Jul", balance: 1577.78, delta: 877.78, income: 4200, spent: 3100, editedAt: null, forBills: 222.22, bills: { saved: 222.22, paid: 0 } },
  { key: "2026-08", label: "Aug", balance: 2055.56, delta: 477.78, income: 4200, spent: 3500, editedAt: null, forBills: 222.22, bills: { saved: 222.22, paid: 0 } },
  { key: "2026-09", label: "Sep", balance: 2833.34, delta: 777.78, income: 4200, spent: 3500, editedAt: null, forBills: -77.78, bills: { saved: 122.22, paid: 200 } },
  // From here 0.8.0 had no carry.
  { key: "2026-10", label: "Oct", balance: 3511.12, delta: 677.78, income: 5000, spent: 4100, editedAt: null, forBills: 222.22, bills: { saved: 222.22, paid: 0 } },
  { key: "2026-11", label: "Nov", balance: 3211.12, delta: -300, income: 5000, spent: 5300, editedAt: null },
  { key: "2026-12", label: "Dec", balance: 3858.34, delta: 647.22, income: 5000, spent: 4300, editedAt: null, forBills: 52.78, bills: { saved: 152.78, paid: 100 } },
];
const FUNDS_080 = [
  ["2026-04", { saved: 100, paid: 0 }],
  ["2026-07", { saved: 222.22, paid: 0 }],
  ["2026-08", { saved: 222.22, paid: 0 }],
  ["2026-09", { saved: 122.22, paid: 200 }],
  ["2026-10", { saved: 222.22, paid: 0 }],
  ["2026-12", { saved: 152.78, paid: 100 }],
];
const before = (k) => k === "start" || k < "2026-10";

describe("before carrying starts, everything is as in 0.8.0", () => {
  it("every Savings row and bill saving before October", () => {
    const d = frozen();
    expect(leftOverHistory(d, JAN_10).series.filter((r) => before(r.key))).toEqual(ROWS_080.filter((r) => before(r.key)));
    expect([...fundHistory(d, JAN_10)].filter(([k]) => before(k))).toEqual(FUNDS_080.filter(([k]) => before(k)));
  });

  it("from October, the set-aside is saved and the rest carries", () => {
    // October: 900 less 300 set aside less 222.22 for bills. November: 377.78
    // carried in, 300 over, so 77.78 set aside. December pays 100 of the
    // water bill from savings and puts 611.12/4 towards the insurance.
    const d = frozen();
    expect([...carryChain(d, JAN_10)]).toEqual([
      ["2026-10", entry(0, 300, 222.22, 0, 377.78)],
      ["2026-11", entry(377.78, 77.78, 0, 0, 0)],
      ["2026-12", entry(0, 300, 152.78, 100, 347.22)],
    ]);
    expect(carriedInto(d, "2027-01", JAN_10)).toBe(347.22);
    const rows = leftOverHistory(d, JAN_10).series.filter((r) => !before(r.key));
    expect(rows.map((r) => [r.key, r.delta, r.carried, r.setAsideWanted])).toEqual([
      ["2026-10", 300, 377.78, 300], ["2026-11", 77.78, 0, 300], ["2026-12", 300, 347.22, 300],
    ]);
  });

  it("with a set-aside change after the update, and bills saved for across the start", () => {
    // In November the set-aside went up to 500. Nothing before October moves.
    const d = frozen({ savingsGoal: { monthly: 500, history: [{ from: EARLIEST, monthly: 300 }, { from: "2026-11", monthly: 500 }] } });
    expect(leftOverHistory(d, JAN_10).series.filter((r) => before(r.key))).toEqual(ROWS_080.filter((r) => before(r.key)));
    expect([...fundHistory(d, JAN_10)].filter(([k]) => before(k))).toEqual(FUNDS_080.filter(([k]) => before(k)));
    // October keeps its 300; December sets aside 500 of its 800.
    expect([...carryChain(d, JAN_10)]).toEqual([
      ["2026-10", entry(0, 300, 222.22, 0, 377.78)],
      ["2026-11", entry(377.78, 77.78, 0, 0, 0)],
      ["2026-12", entry(0, 500, 152.78, 100, 147.22)],
    ]);
  });
});

describe("with carrying off, everything is as in 0.8.0", () => {
  const off = () => frozen({ carry: { on: false, from: "2026-10" } });

  it("every Savings row and bill saving", () => {
    const d = off();
    expect(carryChain(d, JAN_10).size).toBe(0);
    expect(leftOverHistory(d, JAN_10).series).toEqual(ROWS_080);
    expect(leftOverHistory(d, JAN_10).total).toBe(3858.34);
    expect([...fundHistory(d, JAN_10)]).toEqual(FUNDS_080);
  });

  // The Dashboard's figures, worked out as App.jsx does with the split.
  const dashboard = (data, today) => {
    const cal = calendarFor(data);
    const k = cal.current(today);
    const income = periodIncome(data.months[k], k, today, cal).total;
    const spent = periodSpending(data.months[k], k, today, cal).total;
    const now = fundTotals(sinkingFunds(data, today));
    const carriedIn = carriedInto(data, k, today);
    const setAside = perPeriodOf(setAsideAt(data, k), cal, k);
    const s = splitPeriod({ carriedIn, income, spent, paidFromFund: now.paidFromFund, setAside, billsWanted: now.setAside });
    return {
      remaining: carriedIn + income - spent,
      setAside: s.setAsideApplied,
      shortfall: Math.max(0, setAside - Math.max(0, s.available)),
      bills: s.billsSaved,
      leftToSpend: Math.max(0, s.carriedOut),
    };
  };
  const spending = (amount) => {
    const d = off();
    d.months["2027-01"].expenses[0].amount = amount;
    return d;
  };

  it("the Dashboard's Remaining, set-aside, shortfall, bills and left to spend", () => {
    // 0.8.0 wanted 252.78 for bills this month: 152.78 insurance, 100 water.
    expect(dashboard(spending(4500), JAN_10)).toEqual({ remaining: 500, setAside: 300, shortfall: 0, bills: 200, leftToSpend: 0 });
    expect(dashboard(spending(4800), JAN_10)).toEqual({ remaining: 200, setAside: 200, shortfall: 100, bills: 0, leftToSpend: 0 });
    expect(dashboard(spending(1200), JAN_10)).toEqual({ remaining: 3800, setAside: 300, shortfall: 0, bills: 252.78, leftToSpend: 3247.22 });
  });
});
