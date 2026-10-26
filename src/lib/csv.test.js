import { describe, it, expect } from "vitest";
import { csvDialect, csvEscape, budgetToRows, rowsToCsv, budgetToCsv, CSV_COLUMNS, CSV_PAYER_COLUMNS } from "./csv.js";

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

describe("budgetToRows with a split receipt", () => {
  it("writes one row per part, so totals by category add up", () => {
    const rows = budgetToRows({ months: { "2026-09": { expenses: [{ name: "Tesco", amount: 100, date: "2026-09-02", category: "Food",
      splits: [{ category: "Food", amount: 70 }, { category: "Home", amount: 30 }] }] } } }, {});
    expect(rows.map((r) => [r.type, r.category, r.amount])).toEqual([["Expense (split)", "Food", -70], ["Expense (split)", "Home", -30]]);
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

// Who paid, for a budget shared by two or more people.
describe("who paid, in the export", () => {
  const people = [{ id: "a", name: "Ann", color: "#6366f1" }, { id: "b", name: "Ben", color: "#10b981" }];
  const accounts = [{ id: "visa", name: "Visa", owner: "a" }, { id: "joint", name: "Joint account" }];
  const opts = { resolveRecurringDate: resolve, locale: "en-US", bom: false };
  const shared = () => {
    const d = fixture();
    d.people = people;
    d.accounts = accounts;
    const m = d.months["2026-10"];
    m.expenses[0] = { ...m.expenses[0], paidBy: "a", paidWith: "visa" };
    m.recurring[0] = { ...m.recurring[0], paidBy: "joint", paidWith: "joint" };
    m.upcoming[0] = { ...m.upcoming[0], paidBy: "b" };
    m.credits[1] = { ...m.credits[1], paidBy: "b" };
    return d;
  };
  const lineOf = (csv, name) => csv.split("\r\n").find((l) => l.includes(name));

  it("adds Paid by and Paid with after Note, only for a shared budget", () => {
    expect(budgetToCsv(shared(), opts).split("\r\n")[0]).toBe(`${CSV_COLUMNS.join(",")},Paid by,Paid with`);
    expect(budgetToCsv(shared(), opts).split("\r\n")[0]).toMatch(/Note,Paid by,Paid with$/);
    expect(CSV_PAYER_COLUMNS).toEqual(["Paid by", "Paid with"]);
  });

  it("writes the person's name, Joint, the account's name, and nothing where unknown", () => {
    const csv = budgetToCsv(shared(), opts);
    expect(lineOf(csv, "Groceries")).toBe("2026-10,2026-10-05,Expense,Groceries,Food,-123.40,PLN,,weekly shop,Ann,Visa");
    expect(lineOf(csv, "Rent")).toBe("2026-10,2026-10-01,Recurring,Rent,Home,-2000.00,PLN,Pays itself,,Joint,Joint account");
    expect(lineOf(csv, "Dentist")).toBe("2026-10,2026-10-20,Upcoming,Dentist,Health,-300.00,PLN,Pending,,Ben,");
    expect(lineOf(csv, "Refund")).toBe("2026-10,2026-10-12,Credit,Refund,Refund,49.99,PLN,,,Ben,");
    expect(lineOf(csv, "Salary")).toBe("2026-10,2026-10-10,Recurring credit,Salary,Salary,8000.00,PLN,,,,");
  });

  it("keeps the name of someone removed, and leaves a gone person or account empty", () => {
    const d = shared();
    d.people = [people[0], { ...people[1], removed: true }, { id: "c", name: "Cy", color: "#f59e0b" }];
    d.months["2026-10"].expenses[0] = { ...d.months["2026-10"].expenses[0], paidBy: "ghost", paidWith: "gone" };
    const csv = budgetToCsv(d, opts);
    expect(lineOf(csv, "Dentist")).toMatch(/,Ben,$/);
    expect(lineOf(csv, "Groceries")).toMatch(/weekly shop,,$/);
  });

  it("puts the payer on every part of a split receipt", () => {
    const d = shared();
    d.months["2026-10"].expenses[0] = { ...d.months["2026-10"].expenses[0], paidBy: "a",
      splits: [{ category: "Food", amount: 100 }, { category: "Home", amount: 23.4 }] };
    const rows = budgetToRows(d, { resolveRecurringDate: resolve }).filter((r) => r.name === "Groceries");
    expect(rows.map((r) => [r.category, r.paidBy])).toEqual([["Food", "Ann"], ["Home", "Ann"]]);
  });

  it("guards a name that looks like a formula, like every other text cell", () => {
    const d = shared();
    d.people = [{ id: "a", name: "=SUM(A1)", color: "#6366f1" }, people[1]];
    expect(lineOf(budgetToCsv(d, opts), "Groceries")).toContain(",'=SUM(A1),Visa");
  });

  it("writes the two columns from rowsToCsv only when asked", () => {
    const row = { period: "p", date: "d", type: "Expense", name: "X", category: "C", amount: -1, currency: "PLN", status: "", note: "n", paidBy: "Ann", paidWith: "Visa" };
    expect(rowsToCsv([row], { bom: false }).split("\r\n")[1]).toBe("p,d,Expense,X,C,-1.00,PLN,,n");
    expect(rowsToCsv([row], { bom: false, payer: true }).split("\r\n")[1]).toBe("p,d,Expense,X,C,-1.00,PLN,,n,Ann,Visa");
  });

  it("leaves a one-person export exactly as it was, even with payers left over from a shared time", () => {
    // What the export wrote before payers existed.
    const BEFORE = "Period,Date,Type,Name,Category,Amount,Currency,Status,Note\r\n"
      + "2026-09,2026-09-28,Expense,Old,Food,-10.00,PLN,,\r\n"
      + "2026-10,2026-10-01,Recurring,Rent,Home,-2000.00,PLN,Pays itself,\r\n"
      + "2026-10,2026-10-03,Upcoming,Vet,Health,-80.00,PLN,Paid,\r\n"
      + "2026-10,2026-10-05,Expense,Groceries,Food,-123.40,PLN,,weekly shop\r\n"
      + "2026-10,2026-10-10,Recurring credit,Salary,Salary,8000.00,PLN,,\r\n"
      + "2026-10,2026-10-12,Credit,Refund,Refund,49.99,PLN,,\r\n"
      + "2026-10,2026-10-20,Upcoming,Dentist,Health,-300.00,PLN,Pending,\r\n";
    expect(budgetToCsv(fixture(), opts)).toBe(BEFORE);
    const oneLeft = shared();
    oneLeft.people = [people[0], { ...people[1], removed: true }];
    expect(budgetToCsv(oneLeft, opts)).toBe(BEFORE);
    const justOne = { ...shared(), people: [people[0]] };
    expect(budgetToCsv(justOne, opts)).toBe(BEFORE);
  });
});
