import { describe, it, expect } from "vitest";
import { findRegularPayments, convertToRecurring, dismissRegular } from "./regular.js";
import { periodSpending } from "./totals.js";

const D = (y, m, d) => new Date(y, m - 1, d);
const TODAY = D(2026, 10, 20);
const ex = (id, name, amount, date, category = "Fun") => ({ id, name, amount, date, category });
const month = (...expenses) => ({ income: 8000, expenses, recurring: [], upcoming: [], credits: [] });

const data = {
  cutoffDay: 1,
  recurringTemplate: [{ id: "t1", name: "Rent", amount: 2400, dayOfMonth: 1 }],
  months: {
    "2026-08": month(
      ex("n8", "NETFLIX.COM 1234", 49, "2026-08-14"), ex("g8", "Gym Pro", 120, "2026-08-02", "Health"),
      ex("b8a", "Biedronka", 80, "2026-08-03", "Food"), ex("b8b", "Biedronka", 95, "2026-08-17", "Food"),
      ex("r8", "Rent", 2400, "2026-08-01"), ex("p8", "Phone", 60, "2026-08-05")),
    "2026-09": month(
      ex("n9", "Netflix.com 99", 49, "2026-09-15"), ex("g9", "Gym Pro", 120, "2026-09-03", "Health"),
      ex("b9", "Biedronka", 70, "2026-09-04", "Food"), ex("p9", "Phone", 140, "2026-09-05")),
    "2026-10": month(
      ex("n10", "NETFLIX.COM 5678", 52, "2026-10-13"), ex("g10", "Gym Pro", 120, "2026-10-28", "Health")),
  },
};

describe("findRegularPayments", () => {
  const found = findRegularPayments(data, TODAY);
  const keys = found.map((f) => f.key);

  it("spots a monthly payment, whatever store number the bank adds", () => {
    const n = found.find((f) => f.key === "netflix com");
    expect(n).toMatchObject({ amount: 52, dayOfMonth: 14, months: ["2026-08", "2026-09", "2026-10"], category: "Fun" });
    expect(n.entries.map((e) => e.id)).toEqual(["n8", "n9", "n10"]);
  });

  it("ignores a shop visited more than once a month", () => {
    expect(keys).not.toContain("biedronka");
  });

  it("ignores what is already a recurring bill", () => {
    expect(keys).not.toContain("rent");
  });

  it("needs similar amounts and similar days", () => {
    expect(keys).not.toContain("phone");   // 60 then 140
    expect(keys).not.toContain("gym pro"); // the 2nd, 3rd, then the 28th
  });

  it("needs at least two consecutive months, the latest one recent", () => {
    const sparse = { cutoffDay: 1, months: {
      "2026-06": month(ex("a", "Spotify", 20, "2026-06-10")),
      "2026-08": month(ex("b", "Spotify", 20, "2026-08-10")),
      "2026-10": month(ex("c", "Spotify", 20, "2026-10-10")) } };
    expect(findRegularPayments(sparse, TODAY)).toEqual([]);
    const stale = { cutoffDay: 1, months: {
      "2026-05": month(ex("a", "Spotify", 20, "2026-05-10")),
      "2026-06": month(ex("b", "Spotify", 20, "2026-06-10")) } };
    expect(findRegularPayments(stale, TODAY)).toEqual([]);
  });

  it("stays quiet about a suggestion that was dismissed", () => {
    expect(findRegularPayments(dismissRegular(data, "netflix com"), TODAY).map((f) => f.key)).not.toContain("netflix com");
  });
});

describe("convertToRecurring", () => {
  let n = 0;
  const id = () => `new${++n}`;
  const suggestion = findRegularPayments(data, TODAY).find((f) => f.key === "netflix com");
  const { data: out, removed } = convertToRecurring(data, suggestion, id, TODAY);

  it("adds a monthly recurring bill", () => {
    expect(out.recurringTemplate.at(-1)).toMatchObject({ name: "NETFLIX.COM 1234", amount: 52, dayOfMonth: 14, category: "Fun" });
    expect(out.months["2026-10"].recurring).toHaveLength(1);
  });

  it("turns this month's payment into this month's bill, leaving earlier months as they were", () => {
    expect(removed).toBe(1);
    expect(out.months["2026-10"].expenses.map((e) => e.id)).toEqual(["g10"]);
    expect(out.months["2026-09"]).toBe(data.months["2026-09"]);
  });

  it("counts this month's spending exactly as before", () => {
    const before = periodSpending(data.months["2026-10"], "2026-10", TODAY, 1).total;
    const after = periodSpending(out.months["2026-10"], "2026-10", TODAY, 1).total;
    expect(after).toBe(before);
  });

  it("is no longer suggested afterwards", () => {
    expect(findRegularPayments(out, TODAY).map((f) => f.key)).not.toContain("netflix com");
  });
});
