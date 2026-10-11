import { describe, it, expect } from "vitest";
import { periodDays, scheduledItems, everydayRate, forecast, balanceHistory, spendingByDay } from "./forecast.js";

const D = (y, m, d) => new Date(y, m - 1, d);
const TODAY = D(2026, 10, 10);
const spend = (amount, date) => ({ amount, date, category: "Food", name: "shop" });

// July and August have 31 days, September 30: 92 days of one-off spending
// adding up to 2760 is 30 a day.
const data = {
  cutoffDay: 1,
  months: {
    "2026-07": { income: 8000, expenses: [spend(930, "2026-07-10")], recurring: [], upcoming: [], credits: [] },
    "2026-08": { income: 8000, expenses: [spend(930, "2026-08-10")], recurring: [], upcoming: [], credits: [] },
    "2026-09": { income: 8000, expenses: [spend(900, "2026-09-10")], recurring: [], upcoming: [], credits: [] },
    "2026-10": {
      income: 8000,
      expenses: [spend(1000, "2026-10-05")],
      recurring: [
        { id: "rent", name: "Rent", amount: 2400, dayOfMonth: 1 },
        { id: "nf", name: "Netflix", amount: 49, dayOfMonth: 20 },
      ],
      upcoming: [
        { id: "dent", name: "Dentist", amount: 300, dueDate: "2026-10-05", paid: false },
        { id: "car", name: "Car service", amount: 600, dueDate: "2026-10-25", paid: false },
        { id: "gym", name: "Gym", amount: 90, dueDate: "2026-10-08", paid: true },
      ],
      credits: [{ id: "bonus", name: "Bonus", amount: 500, date: "2026-10-28" }],
    },
  },
};

describe("periodDays", () => {
  it("lists every day of a calendar month", () => {
    const days = periodDays("2026-10", 1);
    expect(days).toHaveLength(31);
    expect([days[0], days[30]]).toEqual(["2026-10-01", "2026-10-31"]);
  });

  it("runs payday to payday", () => {
    const days = periodDays("2026-10", 25);
    expect([days[0], days[days.length - 1]]).toEqual(["2026-10-25", "2026-11-24"]);
  });

  it("is not thrown by the clocks changing", () => {
    expect(periodDays("2026-10", 1).filter((d) => d === "2026-10-25")).toHaveLength(1); // clocks go back on the 25th
    expect(periodDays("2023-02", 27).at(-1)).toBe("2023-03-26");                       // and forward on 26 March 2023
  });
});

describe("scheduledItems", () => {
  it("puts each bill, payment and credit on its day, with what has happened", () => {
    const items = scheduledItems(data, "2026-10", TODAY);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId.rent).toMatchObject({ date: "2026-10-01", status: "done", amount: -2400 });
    expect(byId.nf).toMatchObject({ date: "2026-10-20", status: "due" });
    expect(byId.dent.status).toBe("overdue");
    expect(byId.gym.status).toBe("done");
    expect(byId.bonus).toMatchObject({ date: "2026-10-28", status: "due", amount: 500 });
    expect(items.map((i) => i.date)).toEqual([...items.map((i) => i.date)].sort());
  });
});

describe("everydayRate", () => {
  it("averages one-off spending per day over the last three finished periods", () => {
    expect(everydayRate(data, "2026-10")).toBe(30);
  });

  it("is zero with no history", () => {
    expect(everydayRate({ months: {} }, "2026-10")).toBe(0);
  });
});

describe("forecast", () => {
  const f = forecast(data, "2026-10", TODAY);

  it("starts from what is left now", () => {
    // 8000 income, less 1000 spent, 2400 rent and the 90 gym already paid.
    expect(f.now).toBe(8000 - 1000 - 2400 - 90);
  });

  it("follows the bills and credits still to come, the overdue one first", () => {
    const at = (d) => f.series.find((p) => p.date === d).balance;
    expect(at("2026-10-11")).toBe(f.now - 300);
    expect(at("2026-10-20")).toBe(f.now - 300 - 49);
    expect(at("2026-10-25")).toBe(f.now - 300 - 49 - 600);
    expect(f.end).toBe(f.now - 300 - 49 - 600 + 500);
    expect(f.lowest).toEqual({ date: "2026-10-25", amount: f.now - 949 });
  });

  it("adds everyday spending for the realistic line", () => {
    // Lowest the day before the bonus: 17 days of 30 a day on top of the bills.
    expect(f.lowestWithEveryday).toEqual({ date: "2026-10-27", amount: f.now - 949 - 17 * 30 });
    expect(f.endWithEveryday).toBe(f.end - 21 * 30);
    expect(f.runsShortOn).toBe(null);
  });

  it("says when money would run out", () => {
    const tight = { ...data, months: { ...data.months, "2026-10": { ...data.months["2026-10"], income: 4500 } } };
    // Starts at 1010. The 300 owed, Netflix and 30 a day leave 241 on the
    // 24th; the 600 car service on the 25th takes it under.
    expect(forecast(tight, "2026-10", TODAY).runsShortOn).toBe("2026-10-25");
  });
});

describe("balanceHistory", () => {
  const h = balanceHistory(data, "2026-10", TODAY);
  const at = (d) => h.find((p) => p.date === d).balance;

  it("runs from the first day of the period to today", () => {
    expect(h.map((p) => p.date)).toEqual(periodDays("2026-10", 1).slice(0, 10));
  });

  it("moves on the day each thing happened", () => {
    // Income and the rent on the 1st, the shopping on the 5th, the paid gym on its day.
    expect(at("2026-10-01")).toBe(8000 - 2400);
    expect(at("2026-10-04")).toBe(8000 - 2400);
    expect(at("2026-10-05")).toBe(8000 - 2400 - 1000);
    expect(at("2026-10-08")).toBe(8000 - 2400 - 1000 - 90);
  });

  it("ends at the forecast's starting point", () => {
    expect(h[h.length - 1].balance).toBe(forecast(data, "2026-10", TODAY).now);
  });

  it("counts something dated after today, or paid early, as of today", () => {
    const early = { ...data, months: { ...data.months, "2026-10": { ...data.months["2026-10"],
      expenses: [spend(1000, "2026-10-05"), spend(50, "2026-10-30")] } } };
    const e = balanceHistory(early, "2026-10", TODAY);
    expect(e[e.length - 1].balance).toBe(forecast(early, "2026-10", TODAY).now);
    expect(e[e.length - 2].balance).toBe(8000 - 2400 - 1000 - 90);
  });
});

describe("spendingByDay", () => {
  it("adds up what was spent, day by day, to today", () => {
    const s = spendingByDay(data, "2026-10", TODAY);
    expect(s.length).toBe(10);
    expect(s[0]).toEqual({ date: "2026-10-01", total: 2400 });
    expect(s[4].total).toBe(3400);
    expect(s[9].total).toBe(3490);
  });

  it("covers the whole of a period that has ended", () => {
    const s = spendingByDay(data, "2026-09", TODAY);
    expect(s.length).toBe(30);
    expect(s[8].total).toBe(0);
    expect(s[9].total).toBe(900);
    expect(s[29].total).toBe(900);
  });
});
