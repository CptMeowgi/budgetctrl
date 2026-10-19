import { describe, it, expect } from "vitest";
import { detectFormat, parseStatement } from "./statementFormats.js";

// Made-up statements in each format, shaped like real exports.

// Polish MT940 (the ZBP layout): ~ separates numbered parts of :86:, with the
// title in ~20-~25 and the other side's name in ~32-~33. Amounts use a
// decimal comma; the letter after C/D is the currency's third letter.
const MT940_PL = [
  ":20:MT940",
  ":25:/PL61109010140000071219812874",
  ":28C:00001",
  ":60F:C261001PLN4210,55",
  ":61:2610031003DN45,99NTRFNONREF//",
  ":86:073~00073ZAKUP PRZY UŻYCIU KARTY~20BIEDRONKA 4521 KRAKOW~21PL~3010205561~31000000000000",
  ":61:2610101010CN8000,00NTRFNONREF//",
  ":86:051~00051PRZELEW PRZYCHODZĄCY~20WYNAGRODZENIE ZA 09/2026~3010901014~3100000000000000",
  "~32ACME SP. Z O.O.~33UL. PROSTA 1",
  ":61:2610151015DN2000,00NTRFNONREF//",
  ":86:052~00052PRZELEW WYCHODZĄCY~20CZYNSZ PAŹDZIERNIK~32WSPÓLNOTA MIESZKANIOWA~33ZIELONA 7",
  ":61:2610181018RCN129,00NTRFNONREF//",
  ":86:Storno uznania",
  ":62F:C261031PLN10164,56",
  "-",
].join("\r\n");

// German MT940: ? separates the parts, and the purpose wraps over ?20-?29.
const MT940_DE = [
  "{1:F01DEUTDEFFAXXX0000000000}{2:I940DEUTDEFFXXXXN}{4:",
  ":20:STARTUMS",
  ":25:12030000/1234567890",
  ":28C:0",
  ":60F:C261001EUR1500,00",
  ":61:2610051005DR23,50NDDTNONREF",
  ":86:105?00SEPA-LASTSCHRIFT?20EREF+123?21SVWZ+Strom Oktober?30BYLADEM1",
  "001?31DE02120300000000202051?32Stadtwerke Muenchen?33GmbH",
  ":61:2610071007CR1250,00NTRFNONREF",
  ":86:166?00SEPA-GUTSCHRIFT?20SVWZ+Gehalt Oktober?32Beispiel AG",
  ":62F:C261031EUR2726,50",
  "-}",
].join("\n");

// OFX 1.x is SGML: leaf tags have no closing tag.
const OFX_SGML = [
  "OFXHEADER:100",
  "DATA:OFXSGML",
  "VERSION:102",
  "SECURITY:NONE",
  "ENCODING:USASCII",
  "CHARSET:1252",
  "",
  "<OFX>",
  "<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>GBP",
  "<BANKTRANLIST><DTSTART>20261001<DTEND>20261031",
  "<STMTTRN>",
  "<TRNTYPE>DEBIT",
  "<DTPOSTED>20261003120000[0:GMT]",
  "<TRNAMT>-23.50",
  "<FITID>202610030001",
  "<NAME>TESCO STORES 2231",
  "<MEMO>CARD PAYMENT",
  "</STMTTRN>",
  "<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261025<TRNAMT>2500.00<FITID>2<NAME>EMPLOYER LTD<MEMO>SALARY</STMTTRN>",
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261028<TRNAMT>-3.20<FITID>3<NAME>COFFEE &amp; CO</STMTTRN>",
  "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
].join("\r\n");

// OFX 2.x is XML. A credit card statement, and an amount with a decimal comma.
const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR</CURDEF>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261012</DTPOSTED><TRNAMT>-104,06</TRNAMT><FITID>a</FITID>
<PAYEE><NAME>BOOKING.COM</NAME><ADDR1>Amsterdam</ADDR1></PAYEE><MEMO>Hotel</MEMO></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

// CAMT.053, the EU XML statement. One pending entry, which isn't booked yet.
const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
<BkToCstmrStmt><Stmt><Id>1</Id>
<Ntry><Amt Ccy="EUR">23.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
  <BookgDt><Dt>2026-10-05</Dt></BookgDt><ValDt><Dt>2026-10-05</Dt></ValDt>
  <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Jan Kowalski</Nm></Dbtr><Cdtr><Nm>Stadtwerke M&#252;nchen</Nm></Cdtr></RltdPties>
  <RmtInf><Ustrd>Strom Oktober</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">1250.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
  <BookgDt><DtTm>2026-10-07T09:12:00</DtTm></BookgDt>
  <NtryDtls><TxDtls><RltdPties><Dbtr><Pty><Nm>Beispiel AG</Nm></Pty></Dbtr><Cdtr><Pty><Nm>Jan Kowalski</Nm></Pty></Cdtr></RltdPties>
  <RmtInf><Ustrd>Gehalt</Ustrd><Ustrd> Oktober</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">9.99</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-10-08</Dt></BookgDt>
  <AddtlNtryInf>Kartenzahlung Kiosk</AddtlNtryInf></Ntry>
<Ntry><Amt Ccy="EUR">4.20</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-09</Dt></BookgDt>
  <AddtlNtryInf>Kartenzahlung Baeckerei</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

const brief = (r) => r.transactions.map((t) => [t.date, t.name, t.amount]);

describe("detectFormat", () => {
  it("tells the formats apart by their content", () => {
    expect(detectFormat(MT940_PL)).toBe("mt940");
    expect(detectFormat(MT940_DE)).toBe("mt940");
    expect(detectFormat(OFX_SGML)).toBe("ofx");
    expect(detectFormat(OFX_XML)).toBe("ofx");
    expect(detectFormat(CAMT)).toBe("camt053");
    expect(detectFormat("Date,Description,Amount\n2026-10-01,Shop,-5")).toBe("csv");
  });
});

describe("MT940", () => {
  it("reads a Polish statement: names from ~32-~33, titles from ~20-~25, reversals the other way", () => {
    const r = parseStatement(MT940_PL, "mt940");
    expect(brief(r)).toEqual([
      ["2026-10-03", "BIEDRONKA 4521 KRAKOW PL", -45.99],
      ["2026-10-10", "ACME SP. Z O.O. UL. PROSTA 1", 8000],
      ["2026-10-15", "WSPÓLNOTA MIESZKANIOWA ZIELONA 7", -2000],
      ["2026-10-18", "Storno uznania", -129],
    ]);
    expect(r.transactions[1].note).toBe("WYNAGRODZENIE ZA 09/2026");
    expect(r.transactions[0].note).toBeUndefined();
  });

  it("reads a German statement whose purpose wraps onto the next line", () => {
    const r = parseStatement(MT940_DE, "mt940");
    expect(brief(r)).toEqual([
      ["2026-10-05", "Stadtwerke Muenchen GmbH", -23.5],
      ["2026-10-07", "Beispiel AG", 1250],
    ]);
    expect(r.transactions[0].note).toBe("EREF+123 SVWZ+Strom Oktober");
  });
});

describe("OFX and QFX", () => {
  it("reads OFX 1 (SGML), with entities", () => {
    const r = parseStatement(OFX_SGML, "ofx");
    expect(brief(r)).toEqual([
      ["2026-10-03", "TESCO STORES 2231", -23.5],
      ["2026-10-25", "EMPLOYER LTD", 2500],
      ["2026-10-28", "COFFEE & CO", -3.2],
    ]);
    expect(r.transactions[0].note).toBe("CARD PAYMENT");
  });

  it("reads OFX 2 (XML), a payee inside <PAYEE>, and a decimal comma", () => {
    const r = parseStatement(OFX_XML, "ofx");
    expect(brief(r)).toEqual([["2026-10-12", "BOOKING.COM", -104.06]]);
    expect(r.transactions[0].note).toBe("Hotel");
  });
});

describe("CAMT.053", () => {
  it("reads booked entries, naming each after the other side", () => {
    const r = parseStatement(CAMT, "camt053");
    expect(brief(r)).toEqual([
      ["2026-10-05", "Stadtwerke München", -23.5],
      ["2026-10-07", "Beispiel AG", 1250],
      ["2026-10-09", "Kartenzahlung Baeckerei", -4.2],
    ]);
    expect(r.transactions[0].note).toBe("Strom Oktober");
    expect(r.transactions[1].note).toBe("Gehalt Oktober");
    // The pending entry is left out, and said so: it isn't unreadable.
    expect([r.pending, r.skipped]).toEqual([1, 0]);
  });

  it("splits a batch whose payments each have an amount, naming each after its own payee", () => {
    const batch = `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
      <Ntry><Amt Ccy="EUR">300.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-10-01</Dt></BookgDt>
      <AddtlNtryInf>Sammelueberweisung</AddtlNtryInf><NtryDtls>
        <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">100.00</Amt></TxAmt></AmtDtls><RltdPties><Cdtr><Nm>Alice</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Rent A</Ustrd></RmtInf></TxDtls>
        <TxDtls><AmtDtls><TxAmt><Amt Ccy="EUR">120.00</Amt></TxAmt></AmtDtls><RltdPties><Cdtr><Nm>Bob</Nm></Cdtr></RltdPties></TxDtls>
        <TxDtls><Amt Ccy="EUR">80.00</Amt><RltdPties><Cdtr><Nm>Carol</Nm></Cdtr></RltdPties></TxDtls>
      </NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;
    expect(brief(parseStatement(batch, "camt053"))).toEqual([
      ["2026-10-01", "Alice", -100], ["2026-10-01", "Bob", -120], ["2026-10-01", "Carol", -80],
    ]);
  });

  it("keeps a batch without amounts per payment as one, named by the entry", () => {
    const batch = `<Document><BkToCstmrStmt><Stmt><Ntry><Amt>300.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
      <BookgDt><Dt>2026-10-01</Dt></BookgDt><AddtlNtryInf>Sammelueberweisung</AddtlNtryInf><NtryDtls>
      <TxDtls><RltdPties><Cdtr><Nm>Alice</Nm></Cdtr></RltdPties></TxDtls><TxDtls><RltdPties><Cdtr><Nm>Bob</Nm></Cdtr></RltdPties></TxDtls>
      </NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;
    expect(brief(parseStatement(batch, "camt053"))).toEqual([["2026-10-01", "Sammelueberweisung", -300]]);
  });

  it("reads text in CDATA as it is", () => {
    const cdata = CAMT.replace("<Ustrd>Strom Oktober</Ustrd>", "<Ustrd><![CDATA[Refund <ref> & co]]></Ustrd>");
    expect(parseStatement(cdata, "camt053").transactions[0].note).toBe("Refund <ref> & co");
  });

  it("reads account reports and notifications (camt.052, camt.054) the same way", () => {
    const report = CAMT.replace("camt.053.001.02", "camt.054.001.02").replace(/BkToCstmrStmt/g, "BkToCstmrDbtCdtNtfctn").replace(/<(\/?)Stmt>/g, "<$1Ntfctn>");
    expect(detectFormat(report)).toBe("camt053");
    expect(parseStatement(report, "camt053").transactions).toHaveLength(3);
  });
});

describe("MT940 details that wrap or carry codes", () => {
  const one = (details) => parseStatement([":20:X", ":61:2610031003DN10,00NTRF", ...details].join("\r\n"), "mt940").transactions[0];

  it("keeps the space where a line wraps after one", () => {
    const tx = one([":86:020~00PRZELEW~20Zakup w ", "sklepie spozywczym~32JAN ", "KOWALSKI"]);
    expect([tx.name, tx.note]).toEqual(["JAN KOWALSKI", "Zakup w sklepie spozywczym"]);
  });

  it("keeps a continuation line that starts with a dash", () => {
    expect(one([":86:Zakup towaru", "-50% RABAT"]).name).toBe("Zakup towaru -50% RABAT");
  });

  it("reads /NAME/ and /REMI/ codes up to the next code, slashes and all", () => {
    expect(one([":86:/NAME/AB/CD SP. Z O.O./REMI/Faktura 1/2026"])).toMatchObject({ name: "AB/CD SP. Z O.O.", note: "Faktura 1/2026" });
    expect(one([":86:/TRTP/SEPA OVERBOEKING/IBAN/NL00BANK0123456789/NAME/Shop BV/REMI/USTD//Factuur 123/"]))
      .toMatchObject({ name: "Shop BV", note: "Factuur 123" });
  });
});

describe("detectFormat, by how a file starts", () => {
  it("doesn't mistake a CSV that mentions another format for one", () => {
    expect(detectFormat('Date;Description;Amount\n2026-10-01;"Paid via <OFX> export";-5')).toBe("csv");
    expect(detectFormat('Date;Notes;Amount\n2026-10-01;"camt.053 test";-5')).toBe("csv");
    expect(detectFormat('Date;Notes;Amount\n2026-10-01;"line one\n:20:REF\n:61:x";-5')).toBe("csv");
  });

  it("finds MT940 after a byte-order mark or blank lines, even with no entries", () => {
    expect(detectFormat("﻿\r\n\r\n:20:STARTUMS\r\n:25:123\r\n:62F:C261031EUR0,00")).toBe("mt940");
  });
});

describe("parseStatement", () => {
  it("finds nothing in a file of the wrong kind, without throwing", () => {
    expect(parseStatement("not a statement", "mt940").transactions).toEqual([]);
    expect(parseStatement("<OFX></OFX>", "ofx").transactions).toEqual([]);
    expect(parseStatement("<Document/>", "camt053").transactions).toEqual([]);
  });

  it("counts entries it can't read", () => {
    const bad = MT940_PL.replace(":61:2610031003DN45,99", ":61:2613451003DN45,99");
    expect(parseStatement(bad, "mt940").skipped).toBe(1);
  });
});
