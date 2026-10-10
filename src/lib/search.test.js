import { describe, it, expect } from "vitest";
import { fold, allEntries, matches, search, isEmptyQuery } from "./search.js";

const data = {
  cutoffDay: 1,
  months: {
    "2026-08": {
      expenses: [
        { id: "e1", name: "ŻABKA Z1234", amount: 23.5, category: "Food", date: "2026-08-03" },
        { id: "e2", name: "Orlen 551", amount: 280, category: "Transport", date: "2026-08-12", note: "trip to Kraków" },
      ],
      recurring: [{ id: "r1", name: "Rent", amount: 2400, category: "Home", dayOfMonth: 1 }],
      upcoming: [{ id: "u1", name: "Dentist", amount: 300, category: "Health", dueDate: "2026-08-20", paid: true }],
      credits: [{ id: "c1", name: "Refund", amount: 120, category: "Refunds", date: "2026-08-15" }],
    },
    "2026-09": {
      expenses: [{ id: "e3", name: "Orlen 12", amount: 310, category: "Transport", date: "2026-09-12" }],
      recurring: [{ id: "r2", name: "Rent", amount: 2400, category: "Home", dayOfMonth: 1 }],
      upcoming: [],
      credits: [{ id: "c2", name: "Bonus", amount: 1500, source: "Bonus", dayOfMonth: 25 }],
    },
  },
};

describe("fold", () => {
  it("ignores case and Polish accents, ł included", () => {
    expect(fold("ŻABKA Opłata Kraków")).toBe("zabka oplata krakow");
  });
});

describe("allEntries", () => {
  it("dates every entry, recurring ones on their day in that period", () => {
    const rent = allEntries(data).filter((e) => e.entry.name === "Rent").map((e) => e.date);
    expect(rent.sort()).toEqual(["2026-08-01", "2026-09-01"]);
    expect(allEntries(data).find((e) => e.entry.id === "c2").date).toBe("2026-09-25");
  });

  it("files a credit with no category under its source", () => {
    expect(allEntries(data).find((e) => e.entry.id === "c2").category).toBe("Bonus");
  });
});

describe("matches / search", () => {
  const names = (q) => search(data, q).results.map((r) => r.entry.name);

  it("finds a shop typed without accents", () => {
    expect(names({ text: "zabka" })).toEqual(["ŻABKA Z1234"]);
  });

  it("searches notes and categories too", () => {
    expect(names({ text: "krakow" })).toEqual(["Orlen 551"]);
    expect(names({ text: "health" })).toEqual(["Dentist"]);
  });

  it("needs every word to match", () => {
    expect(names({ text: "orlen 12" })).toEqual(["Orlen 12"]);
  });

  it("matches a number against the amount as well as the text", () => {
    expect(names({ text: "280" })).toEqual(["Orlen 551"]);
    expect(names({ text: "23,50" })).toEqual(["ŻABKA Z1234"]);
  });

  it("filters by kind, category, dates and amount", () => {
    expect(names({ kinds: ["credit"] })).toEqual(["Bonus", "Refund"]);
    expect(names({ category: "Transport" })).toEqual(["Orlen 12", "Orlen 551"]);
    expect(names({ from: "2026-09-01", to: "2026-09-30", kinds: ["expense", "recurring"] })).toEqual(["Orlen 12", "Rent"]);
    expect(names({ min: 300, max: 400 })).toEqual(["Orlen 12", "Dentist"]);
  });

  it("lists newest first, and totals what was spent and received", () => {
    const r = search(data, { text: "orlen" });
    expect(r.results.map((x) => x.date)).toEqual(["2026-09-12", "2026-08-12"]);
    expect(r.spent).toBe(590);
    expect(r.received).toBe(0);
    expect(search(data, { kinds: ["credit"] }).received).toBe(1620);
  });
});

describe("isEmptyQuery", () => {
  it("is empty with nothing typed or chosen", () => {
    expect(isEmptyQuery({ text: "  ", kinds: [], min: "" })).toBe(true);
    expect(isEmptyQuery({ text: "a" })).toBe(false);
    expect(isEmptyQuery({ kinds: ["credit"] })).toBe(false);
    expect(isEmptyQuery({ min: 0 })).toBe(false);
  });
});

describe("matches", () => {
  it("accepts an empty query", () => {
    expect(matches(allEntries(data)[0], {})).toBe(true);
  });
});
