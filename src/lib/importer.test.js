import { describe, it, expect } from "vitest";
import {
  decodeBytes, parseCsv, sniffDelimiter, parseAmount, parseDate, detectDateOrder,
  findHeaderRow, guessMapping, normalizeHeader, toTransactions, analyzeImport, applyImport,
  layoutKey, rememberLayout, rememberedLayout,
} from "./importer.js";

// A Polish-bank-style statement: account metadata first, then a ";" table with
// "#"-prefixed headers, decimal commas and a currency suffix on amounts.
const PL_STATEMENT = [
  "Elektroniczne zestawienie operacji;",
  "Klient:;JAN KOWALSKI;",
  "Za okres:;2026-09-01;2026-09-30;",
  "Saldo początkowe:;4 210,55 PLN;",
  "",
  "#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;#Saldo po operacji;",
  "2026-09-03;ZAKUP PRZY UŻYCIU KARTY BIEDRONKA 4521 KRAKÓW;Konto;Jedzenie;-45,99 PLN;4 164,56 PLN;",
  "2026-09-10;PRZELEW PRZYCHODZĄCY ACME SP Z O O WYNAGRODZENIE;Konto;Wpływy;8 000,00 PLN;12 164,56 PLN;",
  "2026-09-15;ZLECENIE STAŁE CZYNSZ;Konto;Mieszkanie;-2 000,00 PLN;10 164,56 PLN;",
  '2026-09-18;"PRZELEW ""ZWROT"" ALLEGRO";Konto;Zwroty;129,00 PLN;10 293,56 PLN;',
].join("\r\n");

// An English-bank-style export with separate money-out / money-in columns and
// day-first dates.
const UK_STATEMENT = [
  "Date,Description,Money Out,Money In,Balance",
  "03/09/2026,TESCO STORES 2231,23.50,,976.50",
  "25/09/2026,EMPLOYER LTD SALARY,,2500.00,3476.50",
  '28/09/2026,"COFFEE, ROASTERY",3.20,,3473.30',
].join("\n");

describe("decodeBytes", () => {
  it("keeps valid UTF-8 as UTF-8 and strips a BOM", () => {
    const bytes = new TextEncoder().encode("\uFEFFŻabka;-5,00");
    expect(decodeBytes(bytes)).toEqual({ text: "Żabka;-5,00", encoding: "utf-8" });
  });

  it("falls back to Windows-1250 so Polish names survive", () => {
    // "Żabka Łódź" in cp1250: Ż=AF Ł=A3 ó=F3 ź=9F
    const bytes = new Uint8Array([0xaf, 0x61, 0x62, 0x6b, 0x61, 0x20, 0xa3, 0xf3, 0x64, 0x9f]);
    expect(decodeBytes(bytes)).toEqual({ text: "Żabka Łódź", encoding: "windows-1250" });
  });
});

describe("parseCsv", () => {
  it("handles quoted delimiters, doubled quotes, embedded newlines and CRLF", () => {
    const rows = parseCsv('a;"b;c";"say ""hi"""\r\n"multi\nline";x;y', ";");
    expect(rows).toEqual([["a", "b;c", 'say "hi"'], ["multi\nline", "x", "y"]]);
  });
  it("drops blank lines", () => {
    expect(parseCsv("a,b\n\n\nc,d\n", ",")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("sniffDelimiter", () => {
  it("finds ; in a Polish statement despite commas inside amounts", () => {
    expect(sniffDelimiter(PL_STATEMENT)).toBe(";");
  });
  it("finds , in an English export", () => {
    expect(sniffDelimiter(UK_STATEMENT)).toBe(",");
  });
  it("finds tabs", () => {
    expect(sniffDelimiter("a\tb\tc\n1\t2\t3\n4\t5\t6")).toBe("\t");
  });
});

describe("parseAmount", () => {
  it.each([
    ["-45,99 PLN", -45.99],
    ["8 000,00 PLN", 8000],
    ["4\u00a0164,56", 4164.56],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["-2,000.00", -2000],
    ["(12.50)", -12.5],
    ["123,45-", -123.45],
    ["+129,00", 129],
    ["23.50", 23.5],
    ["1.234.567", 1234567],
  ])("%s -> %d", (raw, want) => {
    expect(parseAmount(raw)).toBe(want);
  });
  it("rejects text that is not an amount", () => {
    expect(parseAmount("Konto")).toBe(null);
    expect(parseAmount("")).toBe(null);
  });
});

describe("dates", () => {
  it("reads ISO, dotted and slashed dates", () => {
    expect(parseDate("2026-09-03")).toBe("2026-09-03");
    expect(parseDate("03.09.2026")).toBe("2026-09-03");
    expect(parseDate("2026.09.03 14:22")).toBe("2026-09-03");
  });
  it("treats an ambiguous column as day-first, and switches only on evidence", () => {
    expect(detectDateOrder(["03/09/2026", "05/09/2026"])).toBe("DMY");
    expect(detectDateOrder(["03/09/2026", "09/25/2026"])).toBe("MDY");
    expect(detectDateOrder(["25/09/2026"])).toBe("DMY");
    expect(parseDate("09/25/2026", "MDY")).toBe("2026-09-25");
  });
  it("refuses impossible dates instead of rolling them over", () => {
    expect(parseDate("31.02.2026")).toBe(null);
    expect(parseDate("2026-13-01")).toBe(null);
  });
});

// An Alior-style export: a criteria line, then a ";" table with day-first
// dates. Money in carries a "+" and its name in the sender's column; card
// payments have no names, only details; a payment abroad gives the amount in
// its own currency and in the account's. Made-up data, not a real statement.
const ALIOR_STATEMENT = [
  "Kryteria transakcji: Okres: 01-10-2026 - 19-10-2026;Typ transakcji: Uznania/Obciążenia;Produkty: 00000000000000000000000000",
  "Data transakcji;Data księgowania;Nazwa nadawcy;Nazwa odbiorcy;Szczegóły transakcji;Kwota operacji;Waluta operacji;Kwota w walucie rachunku;Waluta rachunku;Numer rachunku nadawcy;Numer rachunku odbiorcy",
  "15-10-2026;15-10-2026;ACME SP. Z O.O.;JAN KOWALSKI;Wynagrodzenie 09/2026;+6 500,00;PLN;+6 500,00;PLN;11111111111111111111111111;22222222222222222222222222",
  "14-10-2026;16-10-2026;;;KOLEO bilety kolejowe Warszawa PL;-17,50;PLN;-17,50;PLN;;",
  "12-10-2026;13-10-2026;;;BOOKING.COM Amsterdam NL;-22,14;EUR;-104,06;PLN;;",
  "10-10-2026;10-10-2026;JAN KOWALSKI;ANNA NOWAK;Za obiad;-50,00;PLN;-50,00;PLN;22222222222222222222222222;33333333333333333333333333",
  "09-10-2026;09-10-2026;ANNA NOWAK;JAN KOWALSKI;Zwrot za bilety;+35,00;PLN;+35,00;PLN;33333333333333333333333333;22222222222222222222222222",
].join("\r\n");

describe("table layout", () => {
  it("skips account metadata and finds the real header", () => {
    const rows = parseCsv(PL_STATEMENT, ";");
    const h = findHeaderRow(rows);
    expect(rows[h][0]).toBe("#Data operacji");
  });

  it("normalises Polish headers", () => {
    expect(normalizeHeader("#Tytuł")).toBe("tytul");
    expect(normalizeHeader("Obciążenia")).toBe("obciazenia");
  });

  it("guesses a single signed amount column", () => {
    const rows = parseCsv(PL_STATEMENT, ";");
    const m = guessMapping(rows[findHeaderRow(rows)]);
    expect(m).toMatchObject({ date: 0, title: 1, amount: 4, debit: -1, credit: -1 });
  });

  it("guesses separate money-out / money-in columns", () => {
    const rows = parseCsv(UK_STATEMENT, ",");
    const m = guessMapping(rows[0]);
    expect(m).toMatchObject({ date: 0, title: 1, debit: 2, credit: 3, amount: -1 });
  });

  it("reads an Alior header: names by direction, details, the account's amount", () => {
    const rows = parseCsv(ALIOR_STATEMENT, ";");
    const h = findHeaderRow(rows);
    expect(h).toBe(1);
    expect(guessMapping(rows[h])).toMatchObject({ date: 0, payer: 2, payee: 3, title: 4, amount: 7, debit: -1, credit: -1 });
  });
});

describe("toTransactions", () => {
  it("turns a Polish statement into signed transactions", () => {
    const rows = parseCsv(PL_STATEMENT, ";");
    const h = findHeaderRow(rows);
    const { transactions, skipped } = toTransactions(rows, h, guessMapping(rows[h]));
    expect(skipped).toBe(0);
    expect(transactions.map((t) => [t.date, t.amount])).toEqual([
      ["2026-09-03", -45.99], ["2026-09-10", 8000], ["2026-09-15", -2000], ["2026-09-18", 129],
    ]);
    expect(transactions[3].name).toBe('PRZELEW "ZWROT" ALLEGRO');
  });

  it("signs money-out negative and money-in positive from split columns", () => {
    const rows = parseCsv(UK_STATEMENT, ",");
    const { transactions } = toTransactions(rows, 0, guessMapping(rows[0]));
    expect(transactions.map((t) => [t.date, t.name, t.amount])).toEqual([
      ["2026-09-03", "TESCO STORES 2231", -23.5],
      ["2026-09-25", "EMPLOYER LTD SALARY", 2500],
      ["2026-09-28", "COFFEE, ROASTERY", -3.2],
    ]);
  });

  it("can invert a statement that writes spending as positive", () => {
    const rows = [["Date", "Description", "Amount"], ["2026-09-01", "Shop", "10.00"]];
    const { transactions } = toTransactions(rows, 0, { date: 0, payee: -1, title: 1, amount: 2, debit: -1, credit: -1 }, { invert: true });
    expect(transactions[0].amount).toBe(-10);
  });

  it("uses the payee as the name and the title as the note when both exist", () => {
    const rows = [["Data", "Kontrahent", "Tytuł", "Kwota"], ["2026-09-01", "Orange Polska", "Faktura 09/2026", "-60,00"]];
    const { transactions } = toTransactions(rows, 0, guessMapping(rows[0]));
    expect(transactions[0]).toMatchObject({ name: "Orange Polska", note: "Faktura 09/2026", amount: -60 });
  });

  it("reads an Alior statement: money in with a plus, names from the right column", () => {
    const rows = parseCsv(ALIOR_STATEMENT, ";");
    const h = findHeaderRow(rows);
    const { transactions, skipped } = toTransactions(rows, h, guessMapping(rows[h]));
    expect(skipped).toBe(0);
    expect(transactions.map((t) => [t.date, t.name, t.amount])).toEqual([
      ["2026-10-15", "ACME SP. Z O.O.", 6500],
      ["2026-10-14", "KOLEO bilety kolejowe Warszawa PL", -17.5],
      ["2026-10-12", "BOOKING.COM Amsterdam NL", -104.06],
      ["2026-10-10", "ANNA NOWAK", -50],
      ["2026-10-09", "ANNA NOWAK", 35],
    ]);
    expect(transactions[0].note).toBe("Wynagrodzenie 09/2026");
    expect(transactions[1].note).toBeUndefined();
  });

  it("names money in from the payee column when the bank has no sender column", () => {
    const rows = [["Data", "Kontrahent", "Tytuł", "Kwota"], ["2026-09-01", "ACME", "Pensja", "+3 000,00"]];
    const { transactions } = toTransactions(rows, 0, guessMapping(rows[0]));
    expect(transactions[0]).toMatchObject({ name: "ACME", note: "Pensja", amount: 3000 });
  });

  it("names a row by its direction after inverting the signs", () => {
    const rows = [["Date", "Payer", "Payee", "Amount"], ["2026-09-01", "Me", "Shop", "10.00"]];
    const { transactions } = toTransactions(rows, 0, { date: 0, payer: 1, payee: 2, title: -1, amount: 3, debit: -1, credit: -1 }, { invert: true });
    expect(transactions[0]).toMatchObject({ name: "Shop", amount: -10 });
  });

  it("skips and counts rows without a usable date or amount", () => {
    const rows = [["Date", "Description", "Amount"], ["2026-09-01", "ok", "-5"], ["Total", "", "-5"], ["2026-09-02", "zero", "0"]];
    const { transactions, skipped } = toTransactions(rows, 0, { date: 0, payee: -1, title: 1, amount: 2, debit: -1, credit: -1 });
    expect(transactions).toHaveLength(1);
    expect(skipped).toBe(2);
  });
});

describe("analyzeImport", () => {
  const data = {
    cutoffDay: 1,
    months: {
      "2026-09": {
        income: 8000,
        expenses: [
          { id: "e-coffee", name: "Coffee", amount: 3.2, date: "2026-09-28", category: "Fun" },
          { id: "e-biedronka", name: "Biedronka", amount: 30, date: "2026-08-30", category: "Food" },
        ],
        recurring: [{ id: "r-rent", name: "Rent", amount: 2000, dayOfMonth: 15, category: "Home" }],
        upcoming: [{ id: "u-dent", name: "Dentist", amount: 300, dueDate: "2026-09-20", paid: false }],
        credits: [],
      },
    },
  };
  const tx = (date, name, amount) => ({ date, name, amount });

  it("applies your import rules to new rows: category and a clean name", () => {
    const withRules = {
      ...data,
      categories: [{ name: "Food" }, { name: "Fun" }],
      creditCategories: [{ name: "Refunds" }],
      importRules: [{ id: "r1", match: "lidl", category: "Food", rename: "Lidl" }, { id: "r2", match: "zwrot", category: "Refunds" }],
    };
    const [spend, refund] = analyzeImport([tx("2026-09-10", "LIDL SP Z O O 0412", -48.2), tx("2026-09-11", "ZWROT 123", 20)], withRules);
    expect(spend).toMatchObject({ action: "expense", name: "Lidl", category: "Food", bankName: "LIDL SP Z O O 0412", rule: "r1" });
    expect(refund).toMatchObject({ action: "credit", category: "Refunds" });
  });

  it("skips a purchase already entered by hand", () => {
    const [r] = analyzeImport([tx("2026-09-28", "COFFEE ROASTERY", -3.2)], data);
    expect(r).toMatchObject({ action: "skip", include: false });
    expect(r.reason).toContain("Coffee");
  });

  it("proposes an Alior statement's money in as credits, ticked", () => {
    const rows = parseCsv(ALIOR_STATEMENT, ";");
    const h = findHeaderRow(rows);
    const { transactions } = toTransactions(rows, h, guessMapping(rows[h]));
    const budget = { cutoffDay: 1, months: { "2026-10": { income: 7000, expenses: [], recurring: [], upcoming: [], credits: [] } } };
    const out = analyzeImport(transactions, budget);
    expect(out.map((r) => [r.name, r.action, r.include])).toEqual([
      ["ACME SP. Z O.O.", "credit", true],
      ["KOLEO bilety kolejowe Warszawa PL", "expense", true],
      ["BOOKING.COM Amsterdam NL", "expense", true],
      ["ANNA NOWAK", "expense", true],
      ["ANNA NOWAK", "credit", true],
    ]);
  });

  it("lets only one of two identical transactions match one existing entry", () => {
    const out = analyzeImport([tx("2026-09-28", "COFFEE", -3.2), tx("2026-09-28", "COFFEE", -3.2)], data);
    expect(out.map((r) => r.action)).toEqual(["skip", "expense"]);
  });

  it("skips a standing order that is already a recurring bill", () => {
    const [r] = analyzeImport([tx("2026-09-15", "ZLECENIE STALE CZYNSZ", -2000)], data);
    expect(r).toMatchObject({ action: "skip", include: false });
    expect(r.reason).toContain("Rent");
  });

  it("marks an upcoming payment paid instead of importing a duplicate", () => {
    const [r] = analyzeImport([tx("2026-09-22", "GABINET STOMATOLOGICZNY", -300)], data);
    expect(r).toMatchObject({ action: "markPaid", include: true, target: { period: "2026-09", id: "u-dent" } });
  });

  it("skips a payment that an earlier import already marked paid", () => {
    // Statements overlap. The first import settled the dentist by ticking the
    // upcoming bill rather than adding an expense, so a second import must
    // recognise the paid bill, not add a duplicate 300.
    const paid = JSON.parse(JSON.stringify(data));
    paid.months["2026-09"].upcoming[0].paid = true;
    const [r] = analyzeImport([tx("2026-09-22", "GABINET STOMATOLOGICZNY", -300)], paid);
    expect(r).toMatchObject({ action: "skip", include: false });
    expect(r.reason).toContain("Dentist");
  });

  it("re-importing the same statement adds nothing", () => {
    let n = 0;
    const first = analyzeImport([
      tx("2026-09-03", "BIEDRONKA", -45.99), tx("2026-09-22", "GABINET", -300), tx("2026-09-18", "ZWROT", 129),
    ], data);
    const { data: after } = applyImport(data, first, () => `id${++n}`);
    const second = analyzeImport([
      tx("2026-09-03", "BIEDRONKA", -45.99), tx("2026-09-22", "GABINET", -300), tx("2026-09-18", "ZWROT", 129),
    ], after);
    expect(second.map((r) => r.action)).toEqual(["skip", "skip", "skip"]);
  });

  it("skips the salary, which is already the period's income", () => {
    const [r] = analyzeImport([tx("2026-09-10", "ACME WYNAGRODZENIE", 8000)], data);
    expect(r).toMatchObject({ action: "skip", include: false });
  });

  it("imports genuinely new money in as a credit", () => {
    const [r] = analyzeImport([tx("2026-09-18", "ALLEGRO ZWROT", 129)], data);
    expect(r).toMatchObject({ action: "credit", include: true });
  });

  it("suggests a category from what the user has filed before", () => {
    const [r] = analyzeImport([tx("2026-09-03", "BIEDRONKA 4521 KRAKOW", -45.99)], data);
    expect(r).toMatchObject({ action: "expense", category: "Food" });
  });

  it("files each transaction under the period its date falls in, respecting the cutoff", () => {
    const d = { ...data, cutoffDay: 10 };
    const out = analyzeImport([tx("2026-09-05", "A", -1), tx("2026-09-12", "B", -1)], d);
    expect(out.map((r) => r.period)).toEqual(["2026-08", "2026-09"]);
  });
});

describe("applyImport", () => {
  it("adds kept rows, marks payments paid, and creates periods that did not exist", () => {
    const data = {
      months: { "2026-09": { income: 0, expenses: [], recurring: [], credits: [],
        upcoming: [{ id: "u1", name: "Dentist", amount: 300, dueDate: "2026-09-20", paid: false }] } },
    };
    const rows = [
      { action: "expense", include: true, period: "2026-09", date: "2026-09-03", name: "Shop", amount: -45.99, category: "Food" },
      { action: "expense", include: false, period: "2026-09", date: "2026-09-04", name: "Dropped", amount: -1 },
      { action: "credit", include: true, period: "2026-07", date: "2026-07-02", name: "Refund", amount: 20 },
      { action: "markPaid", include: true, target: { period: "2026-09", id: "u1" } },
      { action: "skip", include: false, period: "2026-09" },
    ];
    let n = 0;
    const { data: out, counts } = applyImport(data, rows, () => `id${++n}`);
    expect(counts).toEqual({ expenses: 1, credits: 1, markedPaid: 1 });
    expect(out.months["2026-09"].expenses).toEqual([
      { id: "id1", name: "Shop", amount: 45.99, date: "2026-09-03", category: "Food", note: undefined, imported: true },
    ]);
    expect(out.months["2026-07"].credits[0]).toMatchObject({ name: "Refund", amount: 20, category: "Other" });
    expect(out.months["2026-09"].upcoming[0].paid).toBe(true);
    expect(data.months["2026-07"]).toBeUndefined(); // input not mutated
  });

  it("starts a period after the running one as it would have started: income carried, its bills copied", () => {
    const data = {
      cutoffDay: 1,
      months: { "2026-10": { income: 4000, expenses: [], upcoming: [], credits: [],
        recurring: [{ id: "r1", name: "Rent", amount: 1000, dayOfMonth: 1, templateId: "tr" }] } },
      recurringTemplate: [{ id: "tr", name: "Rent", amount: 1000, dayOfMonth: 1 }],
      creditTemplate: [],
    };
    const rows = [{ action: "expense", include: true, period: "2026-11", date: "2026-11-05", name: "Concert", amount: -80, category: "Fun" }];
    let n = 0;
    const { data: out } = applyImport(data, rows, () => `id${++n}`, new Date(2026, 9, 20, 12));
    const nov = out.months["2026-11"];
    expect(nov.income).toBe(4000);
    expect(nov.recurring.map((r) => r.name)).toEqual(["Rent"]);
    expect(nov.expenses.map((e) => e.name)).toEqual(["Concert"]);
  });

  describe("who paid", () => {
    const TODAY = new Date(2026, 9, 20, 12);
    const people = [{ id: "a", name: "Ann", color: "#6366f1" }, { id: "b", name: "Ben", color: "#10b981" }];
    const accounts = [{ id: "visa", name: "Visa", owner: "a" }, { id: "benCard", name: "Ben's card", owner: "b" }];
    const shared = () => ({
      people, accounts,
      months: { "2026-10": { income: 0, expenses: [], recurring: [], credits: [],
        upcoming: [{ id: "u1", name: "Dentist", amount: 300, dueDate: "2026-10-20", paid: false, paidBy: "b", paidWith: "benCard" }] } },
    });
    const expenseRow = { action: "expense", include: true, period: "2026-10", date: "2026-10-03", name: "Shop", amount: -45.99, category: "Food" };
    const creditRow = { action: "credit", include: true, period: "2026-10", date: "2026-10-05", name: "Refund", amount: 20 };
    const run = (data, rows, payer) => {
      let n = 0;
      return applyImport(data, rows, () => `id${++n}`, TODAY, payer).data;
    };

    it("marks everything imported as paid by the chosen person and card", () => {
      const d = run(shared(), [expenseRow, creditRow], { paidBy: "a", paidWith: "visa" });
      expect(d.months["2026-10"].expenses.at(-1)).toMatchObject({ paidBy: "a", paidWith: "visa" });
      expect(d.months["2026-10"].credits.at(-1)).toMatchObject({ paidBy: "a", paidWith: "visa" });
    });

    it("can say joint, with no card", () => {
      const d = run(shared(), [expenseRow], { paidBy: "joint" });
      const added = d.months["2026-10"].expenses[0];
      expect(added.paidBy).toBe("joint");
      expect(added).not.toHaveProperty("paidWith");
    });

    it("drops what no longer fits: an unknown person, or someone else's card", () => {
      const d = run(shared(), [expenseRow, creditRow], { paidBy: "ghost", paidWith: "benCard" });
      expect(d.months["2026-10"].expenses[0]).not.toHaveProperty("paidBy");
      expect(d.months["2026-10"].expenses[0]).toHaveProperty("paidWith", "benCard");
      const e = run(shared(), [expenseRow], { paidBy: "a", paidWith: "benCard" }).months["2026-10"].expenses[0];
      expect(e).toHaveProperty("paidBy", "a");
      expect(e).not.toHaveProperty("paidWith");
    });

    it("adds nothing when no payer is given", () => {
      for (const payer of [undefined, {}]) {
        const d = run(shared(), [expenseRow, creditRow], payer);
        for (const e of [d.months["2026-10"].expenses[0], d.months["2026-10"].credits[0]]) {
          expect(e).not.toHaveProperty("paidBy");
          expect(e).not.toHaveProperty("paidWith");
        }
      }
    });

    it("leaves the payer of an upcoming payment alone when marking it paid", () => {
      const markPaid = { action: "markPaid", include: true, target: { period: "2026-10", id: "u1" } };
      const d = run(shared(), [markPaid], { paidBy: "a", paidWith: "visa" });
      expect(d.months["2026-10"].upcoming[0]).toMatchObject({ paid: true, paidBy: "b", paidWith: "benCard" });
    });

    it("gives the same result as before for a payer-less call", () => {
      const rows = [expenseRow];
      const before = run({ months: {} }, rows);
      expect(before.months["2026-10"].expenses).toEqual([
        { id: "id1", name: "Shop", amount: 45.99, date: "2026-10-03", category: "Food", note: undefined, imported: true },
      ]);
    });
  });
});

describe("remembered column layouts", () => {
  const header = ["#Data operacji", "#Opis operacji", "#Rachunek", "#Kategoria", "#Kwota", "#Saldo po operacji"];
  const layout = { mapping: { date: 0, payee: -1, payer: -1, title: 3, amount: 4, debit: -1, credit: -1 }, splitAmounts: false, invert: true };

  it("keys a layout by the header row, whatever its case, accents or spacing", () => {
    expect(layoutKey(header)).toBe(layoutKey(["Data operacji ", "opis OPERACJI", "#Rachunek", "#Kategoria", "#Kwota", "#Saldo po operacji"]));
    expect(layoutKey(header)).not.toBe(layoutKey(header.slice(0, 5)));
  });

  it("remembers a layout and finds it for the next file with that header", () => {
    const layouts = rememberLayout([], header, layout);
    expect(rememberedLayout({ importLayouts: layouts }, header)).toEqual(layout);
    expect(rememberedLayout({ importLayouts: layouts }, ["Date", "Amount"])).toBeNull();
    expect(rememberedLayout({}, header)).toBeNull();
  });

  it("replaces the layout for a header instead of adding another, newest first", () => {
    const other = ["Date", "Description", "Amount"];
    let layouts = rememberLayout([], header, layout);
    layouts = rememberLayout(layouts, other, { ...layout, invert: false });
    layouts = rememberLayout(layouts, header, { ...layout, invert: false });
    expect(layouts).toHaveLength(2);
    expect(layouts[0].key).toBe(layoutKey(header));
    expect(rememberedLayout({ importLayouts: layouts }, header).invert).toBe(false);
  });

  it("keeps the 20 most recent", () => {
    let layouts = [];
    const two = { mapping: { date: 0, payee: -1, payer: -1, title: -1, amount: 1, debit: -1, credit: -1 }, splitAmounts: false, invert: false };
    for (let i = 0; i < 25; i++) layouts = rememberLayout(layouts, [`Date ${i}`, "Amount"], two);
    expect(layouts).toHaveLength(20);
    expect(rememberedLayout({ importLayouts: layouts }, ["Date 24", "Amount"])).not.toBeNull();
    expect(rememberedLayout({ importLayouts: layouts }, ["Date 0", "Amount"])).toBeNull();
  });

  it("doesn't remember a file with no header row: its first row is a transaction", () => {
    const first = ["2026-10-01", "Lidl", "-23,40"];
    expect(rememberLayout([], first, layout)).toEqual([]);
    const forced = [{ key: layoutKey(first), mapping: { date: 0, title: 1, amount: 2 }, splitAmounts: false, invert: false }];
    expect(rememberedLayout({ importLayouts: forced }, first)).toBeNull();
  });

  it("tells headers in other scripts apart", () => {
    expect(layoutKey(["Дата", "Описание", "Сумма"])).not.toBe(layoutKey(["交易日期", "摘要", "金额"]));
    expect(layoutKey(["Дата", "Описание", "Сумма"])).toBe(layoutKey(["дата", "описание", "сумма "]));
  });

  it("fills in a column an older layout didn't have", () => {
    const old = [{ key: layoutKey(header), mapping: { date: 0, payee: -1, title: 1, amount: 4, debit: -1, credit: -1 }, splitAmounts: false, invert: false }];
    expect(rememberedLayout({ importLayouts: old }, header).mapping.payer).toBe(-1);
  });

  it("ignores a saved layout whose columns don't fit the file", () => {
    const layouts = [{ key: layoutKey(header), mapping: { ...layout.mapping, amount: 9 }, splitAmounts: false, invert: false }];
    expect(rememberedLayout({ importLayouts: layouts }, header)).toBeNull();
  });
});

describe("statement import and locked periods", () => {
  it("leaves rows for a locked period unticked, and won't mark a payment paid there", () => {
    const data = {
      cutoffDay: 1,
      months: {
        "2026-03": { income: 0, expenses: [], recurring: [], credits: [],
          upcoming: [{ id: "u1", name: "Dentist", amount: 300, dueDate: "2026-03-20", paid: false }] },
        "2026-10": { income: 0, expenses: [], recurring: [], upcoming: [], credits: [] },
      },
    };
    const isLocked = (k) => k < "2026-07";
    const rows = analyzeImport([
      { date: "2026-03-07", name: "Shop", amount: -20 },
      { date: "2026-03-21", name: "Dental clinic", amount: -300 },
      { date: "2026-10-03", name: "Shop", amount: -20 },
    ], data, { isLocked });
    expect(rows.map((r) => [r.include, !!r.locked])).toEqual([[false, true], [false, true], [true, false]]);
    expect(rows[0].reasonKey).toMatch(/locked/);
  });
});
