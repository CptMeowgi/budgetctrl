import { describe, it, expect } from "vitest";
import { csvDialect, csvEscape, budgetToRows, rowsToCsv, budgetToCsv, CSV_COLUMNS } from "./csv.js";

const resolve = (day, period) => `${period}-${String(day).padStart(2, "0")}`;

function fixture() {
  return {
    currency: "PLN",
    months: {
      "2026-10": {
        expenses: [{ id: "e1", name: "Groceries", amount: 123.4, category: "Food", date: "2026-10-05", note: "weekly shop" }],
        recurring: [{ id: "r1", name: "Rent", amount: 2000, category: "Home", dayOfMonth: 1, autoPay: true }],
        upcoming: [
          { id: "u1", name: "Dentist", amount: 300, category: "Health", dueDate: "2026-10-20", paid: false },
          { id: "u2", name: "Vet", amount: 80, category: "Health", dueDate: "2026-10-03", paid: true },
        ],
        credits: [
          { id: "c1", name: "Salary", amount: 8000, category: "Salary", dayOfMonth: 10 },
          { id: "c2", name: "Refund", amount: 49.99, category: "Refund", date: "2026-10-12" },
        ],
      },
      "2026-09": {
        expenses: [{ id: "e0", name: "Old", amount: 10, category: "Food", date: "2026-09-28" }],
        recurring: [], upcoming: [], credits: [],
      },
    },
  };
}

describe("csvDialect", () => {
  it("uses ; and a decimal comma where the locale's decimal mark is a comma", () => {
    expect(csvDialect("pl-PL")).toEqual({ delimiter: ";", decimal: "," });
    expect(csvDialect("de-DE")).toEqual({ delimiter: ";", decimal: "," });
  });
  it("uses , and a decimal point otherwise", () => {
    expect(csvDialect("en-US")).toEqual({ delimiter: ",", decimal: "." });
    expect(csvDialect("en-GB")).toEqual({ delimiter: ",", decimal: "." });
  });
});

describe("csvEscape", () => {
  it("leaves plain fields alone", () => {
    expect(csvEscape("Groceries")).toBe("Groceries");
  });
  it("quotes fields containing the delimiter, quotes or line breaks, doubling quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape("a;b", ";")).toBe('"a;b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
  it("does not quote a comma when the delimiter is a semicolon", () => {
    expect(csvEscape("12,50", ";")).toBe("12,50");
  });
});

describe("budgetToRows", () => {
  const rows = budgetToRows(fixture(), { resolveRecurringDate: resolve });

  it("emits one row per entry across every period", () => {
    expect(rows).toHaveLength(7);
  });

  it("signs spending negative and money in positive, so a SUM gives the net", () => {
    const net = rows.reduce((a, r) => a + r.amount, 0);
    expect(Math.round(net * 100) / 100).toBe(8000 + 49.99 - 123.4 - 2000 - 300 - 80 - 10);
  });

  it("resolves recurring items and recurring credits to a date in their period", () => {
    expect(rows.find((r) => r.name === "Rent").date).toBe("2026-10-01");
    expect(rows.find((r) => r.name === "Salary")).toMatchObject({ date: "2026-10-10", type: "Recurring credit" });
  });

  it("reports status: paid, pending, pays itself", () => {
    expect(rows.find((r) => r.name === "Vet").status).toBe("Paid");
    expect(rows.find((r) => r.name === "Dentist").status).toBe("Pending");
    expect(rows.find((r) => r.name === "Rent").status).toBe("Pays itself");
  });

  it("sorts by date, oldest first", () => {
    const dates = rows.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
    expect(rows[0].name).toBe("Old");
  });

  it("carries notes and the currency", () => {
    expect(rows.find((r) => r.name === "Groceries")).toMatchObject({ note: "weekly shop", currency: "PLN" });
  });
});

describe("rowsToCsv", () => {
  it("writes a header, CRLF line endings and a UTF-8 BOM", () => {
    const csv = rowsToCsv([]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toBe("\uFEFF" + CSV_COLUMNS.join(",") + "\r\n");
  });

  it("formats amounts with two decimals in the dialect's decimal mark", () => {
    const row = { period: "2026-10", date: "2026-10-05", type: "Expense", name: "X", category: "C", amount: -123.4, currency: "PLN", status: "", note: "" };
    expect(rowsToCsv([row], { delimiter: ",", decimal: ".", bom: false }).split("\r\n")[1]).toContain(",-123.40,");
    expect(rowsToCsv([row], { delimiter: ";", decimal: ",", bom: false }).split("\r\n")[1]).toContain(";-123,40;");
  });

  it("neutralises formula-looking text but never a negative amount", () => {
    const row = { period: "p", date: "d", type: "Expense", name: "=HYPERLINK(\"x\")", category: "+cat", amount: -5, currency: "PLN", status: "", note: "@note" };
    const line = rowsToCsv([row], { bom: false }).split("\r\n")[1];
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain("'+cat");
    expect(line).toContain("'@note");
    expect(line).toContain(",-5.00,");
  });
});

describe("budgetToCsv", () => {
  it("produces a Polish-Excel-friendly file for pl-PL", () => {
    const csv = budgetToCsv(fixture(), { resolveRecurringDate: resolve, locale: "pl-PL" });
    const lines = csv.replace("\uFEFF", "").trim().split("\r\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(";"));
    const groceries = lines.find((l) => l.includes("Groceries"));
    expect(groceries).toBe("2026-10;2026-10-05;Expense;Groceries;Food;-123,40;PLN;;weekly shop");
  });
});
