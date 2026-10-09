import { describe, it, expect } from "vitest";
import {
  kindOf, isLiability, balanceAsOf, latestBalance, previousBalance, recordBalance, removeBalance,
  closeAccount, reopenAccount, netWorthAsOf, netWorthSeries, netWorthChange, staleAccounts, addDays, daysBetweenISO,
} from "./accounts.js";

const current = { id: "a", name: "Main", kind: "current", balances: [
  { date: "2026-08-01", amount: 5000 }, { date: "2026-09-01", amount: 6200 }, { date: "2026-10-01", amount: 5800 },
] };
const savings = { id: "b", name: "Savings", kind: "savings", balances: [{ date: "2026-08-15", amount: 20000 }] };
const card = { id: "c", name: "Visa", kind: "card", balances: [{ date: "2026-09-10", amount: 1200 }] };
const all = [current, savings, card];

describe("kinds", () => {
  it("treats cards and loans as debts", () => {
    expect(isLiability(card)).toBe(true);
    expect(isLiability({ kind: "loan" })).toBe(true);
    expect(isLiability(savings)).toBe(false);
  });

  it("falls back to a current account for an unknown kind", () => {
    expect(kindOf({ kind: "mystery" }).id).toBe("current");
  });
});

describe("balances", () => {
  it("finds the balance as it stood on a day", () => {
    expect(balanceAsOf(current, "2026-07-31")).toBe(null);
    expect(balanceAsOf(current, "2026-09-15").amount).toBe(6200);
    expect(balanceAsOf(current, "2026-10-01").amount).toBe(5800);
  });

  it("knows the latest and the one before it, whatever order they were stored in", () => {
    const shuffled = { ...current, balances: [current.balances[2], current.balances[0], current.balances[1]] };
    expect(latestBalance(shuffled).amount).toBe(5800);
    expect(previousBalance(shuffled).amount).toBe(6200);
    expect(previousBalance(savings)).toBe(null);
  });

  it("corrects rather than duplicates a balance recorded twice on one day", () => {
    const a = recordBalance(current, { date: "2026-10-01", amount: 5750.555 });
    expect(a.balances).toHaveLength(3);
    expect(latestBalance(a).amount).toBe(5750.56);
  });

  it("keeps balances in date order when one is added in the past", () => {
    const a = recordBalance(current, { date: "2026-08-20", amount: 5500, note: "  after holiday " });
    expect(a.balances.map((b) => b.date)).toEqual(["2026-08-01", "2026-08-20", "2026-09-01", "2026-10-01"]);
    expect(a.balances[1].note).toBe("after holiday");
  });

  it("removes one balance", () => {
    expect(removeBalance(current, "2026-09-01").balances.map((b) => b.amount)).toEqual([5000, 5800]);
  });

  it("does not mutate the account", () => {
    const snap = JSON.stringify(current);
    recordBalance(current, { date: "2026-10-05", amount: 1 });
    removeBalance(current, "2026-08-01");
    expect(JSON.stringify(current)).toBe(snap);
  });
});

describe("net worth", () => {
  it("is assets less debts, each at its last known balance", () => {
    expect(netWorthAsOf(all, "2026-10-09")).toEqual({ assets: 5800 + 20000, debts: 1200, net: 25800 - 1200 });
  });

  it("leaves out accounts with nothing recorded yet", () => {
    expect(netWorthAsOf(all, "2026-08-10")).toEqual({ assets: 5000, debts: 0, net: 5000 });
  });

  it("has a point for each day a balance was recorded, carrying the others forward", () => {
    const s = netWorthSeries(all);
    expect(s.map((p) => p.date)).toEqual(["2026-08-01", "2026-08-15", "2026-09-01", "2026-09-10", "2026-10-01"]);
    expect(s.map((p) => p.net)).toEqual([5000, 25000, 26200, 25000, 24600]);
  });

  it("reports the change over the last 30 days", () => {
    // 9 Sep: 6200 + 20000 = 26200. 9 Oct: 5800 + 20000 - 1200 = 24600.
    expect(netWorthChange(all, "2026-10-09", 30)).toBe(24600 - 26200);
  });

  it("has no change to report when nothing was recorded that far back", () => {
    expect(netWorthChange(all, "2026-08-10", 30)).toBe(null);
  });
});

describe("closing an account", () => {
  it("stops it counting from the day it closed, without rewriting history", () => {
    const closed = closeAccount(savings, "2026-10-05");
    expect(closed.closed).toBe(true);
    expect(netWorthAsOf([closed], "2026-10-04").net).toBe(20000);
    expect(netWorthAsOf([closed], "2026-10-05").net).toBe(0);
    expect(reopenAccount(closed).closed).toBeUndefined();
  });
});

describe("staleAccounts", () => {
  it("flags open accounts not updated for over 30 days", () => {
    expect(staleAccounts(all, "2026-10-09").map((a) => a.name)).toEqual(["Savings"]);
  });

  it("flags an account with no balance at all, but never a closed one", () => {
    const empty = { id: "d", name: "New", kind: "cash", balances: [] };
    const closed = { ...savings, closed: true };
    expect(staleAccounts([empty, closed], "2026-10-09").map((a) => a.name)).toEqual(["New"]);
  });
});

describe("date helpers", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("counts whole days, unaffected by the clock change", () => {
    expect(daysBetweenISO("2026-03-28", "2026-03-30")).toBe(2); // DST starts 29 Mar in Poland
    expect(daysBetweenISO("2026-10-09", "2026-09-09")).toBe(-30);
  });
});
