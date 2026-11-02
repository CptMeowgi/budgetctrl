import { describe, expect, it } from "vitest";
import { budgetFromFile, exportable } from "./exportFiles.js";

const month = (extra = {}) => ({ income: 0, expenses: [], recurring: [], upcoming: [], credits: [], ...extra });

describe("what an exported backup holds", () => {
  it("never the stamps the store keeps in memory", () => {
    const out = exportable({ months: { "2026-10": month() }, budgetOf: "household", budgetGen: 65536, currency: "PLN" });
    expect(out).toEqual({ months: { "2026-10": month() }, currency: "PLN" });
  });

  it("never a share shown from the household, in any list or template", () => {
    const share = { id: "hh-1", fromHousehold: true, name: "Your share to the household", amount: 300 };
    const rent = { id: "r1", name: "Rent", amount: 1450 };
    const out = exportable({
      months: { "2026-10": month({ recurring: [share, rent], credits: [{ ...share, id: "hh-2" }] }) },
      recurringTemplate: [share, rent],
      creditTemplate: [share],
    });
    expect(out.months["2026-10"].recurring).toEqual([rent]);
    expect(out.months["2026-10"].credits).toEqual([]);
    expect(out.recurringTemplate).toEqual([rent]);
    expect(out.creditTemplate).toEqual([]);
  });

  it("is the budget as it is when there is nothing to leave out", () => {
    const doc = { months: { "2026-10": month({ expenses: [{ id: "e1", name: "Lidl", amount: 40 }] }) }, people: [{ id: "a", name: "Anna", hasOwn: true }] };
    expect(exportable(doc)).toEqual(doc);
    expect(JSON.stringify(exportable(doc))).toBe(JSON.stringify(doc));
    // A period gains no lists it didn't have.
    expect(JSON.stringify(exportable({ months: { "2026-10": { income: 5 } } }))).toBe('{"months":{"2026-10":{"income":5}}}');
  });

  it("leaves what it was given as it was", () => {
    const doc = { months: { "2026-10": month({ recurring: [{ id: "hh-1", fromHousehold: true }] }) }, budgetOf: "household" };
    exportable(doc);
    expect(doc.budgetOf).toBe("household");
    expect(doc.months["2026-10"].recurring).toHaveLength(1);
  });
});

describe("a budget read from a file", () => {
  const file = {
    months: { "2026-10": month() },
    budgetOf: "anna1",
    budgetGen: 131072,
    own: { months: {} },
    people: [{ id: "anna1", name: "Anna", hasOwn: true }, { id: "bo", name: "Bo" }],
  };

  it("never says whose it was in memory, and never holds an own budget", () => {
    const out = budgetFromFile(file);
    expect(out).not.toHaveProperty("budgetOf");
    expect(out).not.toHaveProperty("budgetGen");
    expect(out).not.toHaveProperty("own");
  });

  it("keeps who has an own budget when it is one of this computer's backups", () => {
    expect(budgetFromFile(file).people).toEqual(file.people);
  });

  it("doesn't say who has an own budget when it is brought in from a file", () => {
    expect(budgetFromFile(file, { imported: true }).people).toEqual([{ id: "anna1", name: "Anna" }, { id: "bo", name: "Bo" }]);
  });

  it("leaves people it can't read as they are", () => {
    expect(budgetFromFile({ months: {}, people: "x" }, { imported: true }).people).toBe("x");
    expect(budgetFromFile({ months: {}, people: [null, 3] }, { imported: true }).people).toEqual([null, 3]);
  });
});
