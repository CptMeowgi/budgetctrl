import { describe, it, expect } from "vitest";
import { calendarFor } from "./calendar.js";
import { perMonthOf } from "./setAside.js";
import { setAsideAt, withSetAside } from "./setAsideHistory.js";

const month = (extra = {}) => ({ income: 0, expenses: [], recurring: [], upcoming: [], credits: [], ...extra });

describe("withSetAside", () => {
  it("seeds the old amount as applying to everything before", () => {
    const g = withSetAside({ monthly: 500, target: 0 }, 600, "2026-11");
    expect(g.monthly).toBe(600);
    expect(g.history).toEqual([{ from: "0000-00", monthly: 500 }, { from: "2026-11", monthly: 600 }]);
  });

  it("leaves one entry after five changes in the same period", () => {
    let g = { monthly: 500 };
    for (const v of [6, 60, 600, 6000, 60000]) g = withSetAside(g, v, "2026-11");
    expect(g.history.filter((h) => h.from === "2026-11")).toEqual([{ from: "2026-11", monthly: 60000 }]);
    expect(g.history).toHaveLength(2);
    expect(g.monthly).toBe(60000);
  });

  it("leaves two entries after changes in two periods", () => {
    let g = withSetAside({ monthly: 500 }, 600, "2026-10");
    g = withSetAside(g, 700, "2026-11");
    expect(g.history).toEqual([
      { from: "0000-00", monthly: 500 }, { from: "2026-10", monthly: 600 }, { from: "2026-11", monthly: 700 },
    ]);
  });
});

describe("setAsideAt", () => {
  const base = (extra = {}) => ({
    cutoffDay: 1,
    months: { "2026-10": month(), "2026-11": month() },
    savingsGoal: { monthly: 700, history: [{ from: "0000-00", monthly: 500 }, { from: "2026-11", monthly: 700 }] },
    ...extra,
  });

  it("keeps October at the old value when the entry is from November", () => {
    const d = base();
    expect(setAsideAt(d, "2026-10")).toBe(500);
    expect(setAsideAt(d, "2026-11")).toBe(700);
    expect(setAsideAt(d, "2027-01")).toBe(700);
  });

  it("lets an override on the month win", () => {
    const d = base();
    d.months["2026-10"] = month({ setAside: 123 });
    expect(setAsideAt(d, "2026-10")).toBe(123);
  });

  it("converts a per-period override back to a monthly amount", () => {
    const d = base({ paySchedule: [{ kind: "weeks", every: 2, from: "2026-10-02" }] });
    const key = calendarFor(d).keyFor(new Date(2026, 9, 5));
    d.months[key] = month({ setAside: 100 });
    expect(setAsideAt(d, key)).toBe(perMonthOf(100, calendarFor(d), key));
  });

  it("gives savingsGoal.monthly with no history at all", () => {
    const d = base();
    delete d.savingsGoal.history;
    expect(setAsideAt(d, "2026-10")).toBe(700);
  });
});
