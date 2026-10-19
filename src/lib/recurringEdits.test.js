import { describe, it, expect } from "vitest";
import { deleteRecurringCopy, deleteTemplate, editFormFor, saveRecurring } from "./recurringEdits.js";
import { monthlyCalendar } from "./calendar.js";

const cal = monthlyCalendar(1);
const ids = () => { let n = 0; return () => `n${++n}`; };
const MONTHLY = { every: undefined, anchor: undefined, repeat: undefined, startDate: undefined };
const WEEKLY = { repeat: "weeks", every: 1, startDate: "2026-10-02", dayOfMonth: undefined, anchor: undefined };
const base = () => ({
  months: {
    "2026-09": { income: 0, expenses: [], upcoming: [], credits: [],
      recurring: [{ id: "old", name: "Rent", amount: 900, dayOfMonth: 1, templateId: "tr" },
                  { id: "oldw", name: "Cleaner", amount: 40, ...WEEKLY, date: "2026-09-25", templateId: "tw" }] },
    "2026-10": { income: 0, expenses: [], upcoming: [], credits: [],
      recurring: [{ id: "r1", name: "Rent", amount: 900, dayOfMonth: 1, templateId: "tr" },
                  { id: "w1", name: "Cleaner", amount: 40, ...WEEKLY, date: "2026-10-02", templateId: "tw" },
                  { id: "w2", name: "Cleaner", amount: 40, ...WEEKLY, date: "2026-10-09", templateId: "tw" }] },
  },
  recurringTemplate: [{ id: "tr", name: "Rent", amount: 900, dayOfMonth: 1 },
                      { id: "tw", name: "Cleaner", amount: 40, ...WEEKLY }],
  creditTemplate: [],
});
const opts = (o) => ({ cal, curKey: "2026-10", targetKey: "2026-10", editing: null, editingTpl: null, newId: ids(), ...o });

describe("saveRecurring, monthly (as the forms always did)", () => {
  it("adds a template and this period's copy", () => {
    const out = saveRecurring(base(), "recurring", opts({ fields: { name: "Gym", amount: 30, dayOfMonth: 5 }, schedule: MONTHLY }));
    expect(out.recurringTemplate.at(-1)).toMatchObject({ id: "n1", name: "Gym", dayOfMonth: 5 });
    expect(out.months["2026-10"].recurring.at(-1)).toMatchObject({ id: "n2", templateId: "n1", name: "Gym" });
  });

  it("adds a template but no copy when this period is off its cycle", () => {
    const out = saveRecurring(base(), "recurring", opts({ fields: { name: "Insurance", amount: 900, dayOfMonth: 10 }, schedule: { ...MONTHLY, every: 12, anchor: "2027-03" } }));
    expect(out.recurringTemplate).toHaveLength(3);
    expect(out.months["2026-10"].recurring).toHaveLength(3);
  });

  it("edits this period's copy and the template", () => {
    const b = base();
    const out = saveRecurring(b, "recurring", opts({ editing: b.months["2026-10"].recurring[0], fields: { name: "Rent", amount: 950, dayOfMonth: 1 }, schedule: MONTHLY }));
    expect(out.months["2026-10"].recurring[0]).toMatchObject({ id: "r1", amount: 950 });
    expect(out.recurringTemplate[0].amount).toBe(950);
  });

  it("corrects a past period's copy only", () => {
    const b = base();
    const out = saveRecurring(b, "recurring", opts({ targetKey: "2026-09", editing: b.months["2026-09"].recurring[0], fields: { name: "Rent", amount: 880, dayOfMonth: 1 }, schedule: MONTHLY }));
    expect(out.months["2026-09"].recurring[0].amount).toBe(880);
    expect(out.recurringTemplate[0].amount).toBe(900);
    expect(out.months["2026-10"]).toBe(b.months["2026-10"]);
  });
});

describe("saveRecurring, weekly", () => {
  it("adds a template and a copy for each date this period", () => {
    const out = saveRecurring(base(), "recurring", opts({ fields: { name: "Dog walker", amount: 15 }, schedule: { ...WEEKLY, every: 2, startDate: "2026-10-05" } }));
    expect(out.months["2026-10"].recurring.filter((r) => r.templateId === "n1").map((r) => r.date)).toEqual(["2026-10-05", "2026-10-19"]);
  });

  it("edit weekly: redoes every copy this period, leaves past periods alone", () => {
    const b = base();
    const out = saveRecurring(b, "recurring", opts({ editing: b.months["2026-10"].recurring[1], fields: { name: "Cleaner", amount: 45 }, schedule: WEEKLY }));
    const copies = out.months["2026-10"].recurring.filter((r) => r.templateId === "tw");
    expect(copies.map((r) => [r.date, r.amount])).toEqual([["2026-10-02", 45], ["2026-10-09", 45], ["2026-10-16", 45], ["2026-10-23", 45], ["2026-10-30", 45]]);
    // A date that stays keeps its copy's id, so a reminder already shown isn't shown again.
    expect(copies.slice(0, 2).map((r) => r.id)).toEqual(["w1", "w2"]);
    expect(out.recurringTemplate.find((t) => t.id === "tw").amount).toBe(45);
    expect(out.months["2026-09"]).toBe(b.months["2026-09"]);
  });

  it("switching a monthly bill to weekly replaces its copy with dated ones", () => {
    const b = base();
    const out = saveRecurring(b, "recurring", opts({ editing: b.months["2026-10"].recurring[0], fields: { name: "Rent", amount: 225 }, schedule: { ...WEEKLY, startDate: "2026-10-01" } }));
    expect(out.months["2026-10"].recurring.filter((r) => r.templateId === "tr").map((r) => r.date))
      .toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
    expect(out.recurringTemplate[0]).toMatchObject({ repeat: "weeks", amount: 225 });
    expect(out.recurringTemplate[0].dayOfMonth).toBeUndefined();
  });
});

describe("saveRecurring keeps payments already made", () => {
  const today = new Date(2026, 9, 14, 12);

  it("changing a weekly bill's first date mid-period keeps the copies already paid", () => {
    const b = base();
    const out = saveRecurring(b, "recurring", opts({ today, editing: b.months["2026-10"].recurring[1], fields: { name: "Cleaner", amount: 40 }, schedule: { ...WEEKLY, startDate: "2026-10-19" } }));
    expect(out.months["2026-10"].recurring.filter((r) => r.templateId === "tw").map((r) => r.date))
      .toEqual(["2026-10-02", "2026-10-09", "2026-10-19", "2026-10-26"]);
  });

  it("switching a paid monthly bill to weekly keeps this period's payment", () => {
    const b = base();
    const out = saveRecurring(b, "recurring", opts({ today, editing: b.months["2026-10"].recurring[0], fields: { name: "Rent", amount: 250 }, schedule: { ...WEEKLY, startDate: "2026-10-14" } }));
    expect(out.months["2026-10"].recurring.filter((r) => r.templateId === "tr").map((r) => [r.date, r.amount]))
      .toEqual([[undefined, 900], ["2026-10-14", 250], ["2026-10-21", 250], ["2026-10-28", 250]]);
  });
});

describe("deleteRecurringCopy", () => {
  it("removes a monthly copy and its template, as before", () => {
    const b = base();
    const out = deleteRecurringCopy(b, "recurring", "2026-10", b.months["2026-10"].recurring[0]);
    expect(out.months["2026-10"].recurring.map((r) => r.id)).toEqual(["w1", "w2"]);
    expect(out.recurringTemplate.map((t) => t.id)).toEqual(["tw"]);
  });

  it("delete weekly: removes every copy this period and the template, not past ones", () => {
    const b = base();
    const out = deleteRecurringCopy(b, "recurring", "2026-10", b.months["2026-10"].recurring[2]);
    expect(out.months["2026-10"].recurring.map((r) => r.id)).toEqual(["r1"]);
    expect(out.recurringTemplate.map((t) => t.id)).toEqual(["tr"]);
    expect(out.months["2026-09"].recurring.map((r) => r.id)).toEqual(["old", "oldw"]);
  });

  it("works the same for credits", () => {
    const b = { ...base(), months: { "2026-10": { ...base().months["2026-10"], credits: [{ id: "c1", name: "Pay", amount: 10, ...WEEKLY, date: "2026-10-02", templateId: "tc" }, { id: "c2", name: "Pay", amount: 10, ...WEEKLY, date: "2026-10-09", templateId: "tc" }] } },
                creditTemplate: [{ id: "tc", name: "Pay", amount: 10, ...WEEKLY }] };
    const out = deleteRecurringCopy(b, "credits", "2026-10", b.months["2026-10"].credits[0]);
    expect(out.months["2026-10"].credits).toEqual([]);
    expect(out.creditTemplate).toEqual([]);
  });
});

describe("editFormFor", () => {
  it("opens a recurring credit in its own form, wherever it's opened from", () => {
    expect(editFormFor("credit", { id: "c", dayOfMonth: 26 })).toBe("creditRecurring");
    expect(editFormFor("credit", { id: "c", repeat: "weeks", every: 2, date: "2026-11-06" })).toBe("creditRecurring");
    expect(editFormFor("credit", { id: "c", date: "2026-11-06" })).toBe("credit");
    expect(editFormFor("expense", { id: "e", dayOfMonth: 5 })).toBe("expense");
  });
});

// A period made ahead of time (by a pay switch, or an import of a future
// date) holds copies of the bills before it begins. Changing a bill in the
// running period changes them too, as if the period were made afterwards.
describe("periods made ahead of time follow the bills", () => {
  const nov = (n) => `2026-11-${String(n).padStart(2, "0")}`;
  const ahead = () => {
    const b = base();
    b.months["2026-11"] = { income: 0, upcoming: [], credits: [],
      expenses: [{ id: "x", name: "Shop", amount: 5, date: nov(3), category: "Food" }],
      recurring: [{ id: "a1", name: "Rent", amount: 900, dayOfMonth: 1, templateId: "tr" },
                  ...[6, 13, 20, 27].map((d) => ({ id: `aw${d}`, name: "Cleaner", amount: 40, ...WEEKLY, date: nov(d), templateId: "tw" }))] };
    return b;
  };
  const novBills = (out) => out.months["2026-11"].recurring.map((r) => [r.id, r.name, r.amount]);

  it("an edited bill changes there too, and its copies keep their ids", () => {
    const b = ahead();
    const rent = saveRecurring(b, "recurring", opts({ editing: b.months["2026-10"].recurring[0], fields: { name: "Rent", amount: 950, dayOfMonth: 1 }, schedule: MONTHLY }));
    expect(novBills(rent).filter((r) => r[1] === "Rent")).toEqual([["a1", "Rent", 950]]);
    const cleaner = saveRecurring(b, "recurring", opts({ editing: b.months["2026-10"].recurring[1], fields: { name: "Cleaner", amount: 45 }, schedule: WEEKLY, today: new Date(2026, 9, 5, 12) }));
    expect(novBills(cleaner).filter((r) => r[1] === "Cleaner")).toEqual([6, 13, 20, 27].map((d) => [`aw${d}`, "Cleaner", 45]));
  });

  it("a new bill is copied there", () => {
    const out = saveRecurring(ahead(), "recurring", opts({ fields: { name: "Gym", amount: 30, dayOfMonth: 5 }, schedule: MONTHLY }));
    expect(out.months["2026-11"].recurring.filter((r) => r.name === "Gym")).toHaveLength(1);
  });

  it("a bill moved off a date leaves it there", () => {
    const b = ahead();
    const fortnightly = { ...WEEKLY, every: 2 };
    const out = saveRecurring(b, "recurring", opts({ editing: b.months["2026-10"].recurring[1], fields: { name: "Cleaner", amount: 40 }, schedule: fortnightly, today: new Date(2026, 9, 5, 12) }));
    expect(out.months["2026-11"].recurring.filter((r) => r.name === "Cleaner").map((r) => r.date)).toEqual([nov(13), nov(27)]);
  });

  it("a deleted bill goes from there too", () => {
    const b = ahead();
    const out = deleteRecurringCopy(b, "recurring", "2026-10", b.months["2026-10"].recurring[0]);
    expect(out.months["2026-11"].recurring.some((r) => r.name === "Rent")).toBe(false);
    expect(out.months["2026-11"].expenses).toEqual(b.months["2026-11"].expenses);
  });

  it("a bill deleted from \"not due this period\" goes from there too", () => {
    const b = ahead();
    const out = deleteTemplate(b, "recurring", "2026-10", "tr");
    expect(out.recurringTemplate.map((t) => t.id)).toEqual(["tw"]);
    expect(out.months["2026-11"].recurring.some((r) => r.templateId === "tr")).toBe(false);
    expect(out.months["2026-10"]).toEqual(b.months["2026-10"]);
  });

  it("leaves past periods alone, and a correction in one stays there", () => {
    const b = ahead();
    const edited = saveRecurring(b, "recurring", opts({ editing: b.months["2026-10"].recurring[0], fields: { name: "Rent", amount: 950, dayOfMonth: 1 }, schedule: MONTHLY }));
    expect(edited.months["2026-09"]).toEqual(b.months["2026-09"]);
    const corrected = saveRecurring(b, "recurring", opts({ targetKey: "2026-09", editing: b.months["2026-09"].recurring[0], fields: { name: "Rent", amount: 980, dayOfMonth: 1 }, schedule: MONTHLY }));
    expect(corrected.months["2026-11"]).toEqual(b.months["2026-11"]);
  });
});
