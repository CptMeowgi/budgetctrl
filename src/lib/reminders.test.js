import { describe, it, expect } from "vitest";
import { collectDueBills, upcomingSettled, whenLabel, OVERDUE_GRACE_DAYS } from "./reminders.js";

const D = (y, m, d) => new Date(y, m - 1, d);
const names = (bills) => bills.map((b) => `${b.name}(${b.inDays})`);

describe("upcomingSettled", () => {
  const today = D(2026, 9, 14);
  it("is settled once ticked", () => {
    expect(upcomingSettled({ paid: true, dueDate: "2026-09-30" }, today)).toBe(true);
  });
  it("settles a self-paying bill on its due date, not before", () => {
    expect(upcomingSettled({ autoPay: true, dueDate: "2026-09-14" }, today)).toBe(true);
    expect(upcomingSettled({ autoPay: true, dueDate: "2026-09-15" }, today)).toBe(false);
  });
  it("never settles a manual bill on its own, however overdue", () => {
    expect(upcomingSettled({ dueDate: "2026-08-01" }, today)).toBe(false);
  });
});

describe("collectDueBills", () => {
  // The user's real situation on 14 Sep 2026, which once produced a confusing
  // "3 bills due, 1 overdue" digest.
  const real = {
    cutoffDay: 1,
    months: {
      "2026-08": { recurring: [], upcoming: [
        { id: "phys-aug", name: "physio", amount: 300, dueDate: "2026-08-25", paid: false },
        { id: "derm", name: "dermatologist", amount: 280, dueDate: "2026-08-12", paid: false },
      ] },
      "2026-09": {
        recurring: [
          { id: "claude", name: "Claude", amount: 85, dayOfMonth: 14 },
          { id: "apple", name: "Apple Music", amount: 21.99, dayOfMonth: 15 },
        ],
        upcoming: [{ id: "phys-sep", name: "Physio Agata", amount: 300, dueDate: "2026-09-30", paid: false }],
      },
    },
  };
  const today = D(2026, 9, 14);

  it("reproduces the digest: two recurring due, one stale item overdue", () => {
    expect(names(collectDueBills(real, today, 3))).toEqual(["physio(-20)", "Claude(0)", "Apple Music(1)"]);
  });

  it("finds unpaid items stranded in an earlier period and says which", () => {
    const physio = collectDueBills(real, today, 3).find((b) => b.name === "physio");
    expect(physio.periodKey).toBe("2026-08");
  });

  it("stops notifying past the grace window, but the app can still list them", () => {
    expect(OVERDUE_GRACE_DAYS).toBe(30);
    expect(names(collectDueBills(real, today, 3))).not.toContain("dermatologist(-33)");
    expect(names(collectDueBills(real, today, 3, Infinity))).toContain("dermatologist(-33)");
  });

  it("only reaches a future bill once the lead window covers it", () => {
    const has30 = (lead) => names(collectDueBills(real, today, lead)).includes("Physio Agata(16)");
    expect([3, 7, 15].map(has30)).toEqual([false, false, false]);
    expect([16, 30].map(has30)).toEqual([true, true]);
  });

  it("does not mention a recurring bill after its day has passed", () => {
    const later = collectDueBills(real, D(2026, 9, 16), 3);
    expect(names(later).some((n) => n.startsWith("Claude"))).toBe(false);
  });

  it("skips anything that pays itself, recurring or upcoming", () => {
    const d = {
      cutoffDay: 1,
      months: { "2026-09": {
        recurring: [{ id: "a", name: "Netflix", amount: 45, dayOfMonth: 14, autoPay: true }],
        upcoming: [{ id: "b", name: "Insurance", amount: 600, dueDate: "2026-09-01", paid: false, autoPay: true }],
      } },
    };
    expect(collectDueBills(d, today, 30, Infinity)).toEqual([]);
  });

  it("skips ticked-off items", () => {
    const d = { cutoffDay: 1, months: { "2026-09": { recurring: [], upcoming: [
      { id: "x", name: "Vet", amount: 80, dueDate: "2026-09-13", paid: true },
    ] } } };
    expect(collectDueBills(d, today, 3)).toEqual([]);
  });

  it("resolves recurring days against a custom cutoff", () => {
    const d = { cutoffDay: 10, months: { "2026-09": { upcoming: [], recurring: [
      { id: "early", name: "Early", amount: 50, dayOfMonth: 3 },  // lands 3 Oct
      { id: "late", name: "Late", amount: 60, dayOfMonth: 12 },   // lands 12 Sep
    ] } } };
    expect(names(collectDueBills(d, D(2026, 9, 11), 2))).toEqual(["Late(1)"]);
    expect(names(collectDueBills(d, D(2026, 10, 1), 3))).toEqual(["Early(2)"]);
  });

  it("ignores an unparseable due date rather than throwing", () => {
    const d = { cutoffDay: 1, months: { "2026-09": { recurring: [], upcoming: [
      { id: "bad", name: "Bad", amount: 1, dueDate: "nonsense", paid: false },
    ] } } };
    expect(collectDueBills(d, today, 3)).toEqual([]);
  });

  it("is empty when there is no data for the period", () => {
    expect(collectDueBills({ cutoffDay: 1, months: {} }, today, 3)).toEqual([]);
  });
});

describe("whenLabel", () => {
  it("phrases overdue, today, tomorrow and later", () => {
    expect([-3, 0, 1, 5].map(whenLabel)).toEqual(["3d overdue", "due today", "due tomorrow", "due in 5d"]);
  });
});
