import { describe, it, expect } from "vitest";
import { backupName, isBudgetText, parseBackupName, serial } from "./backups.js";

describe("backupName", () => {
  it("dates and times a backup, so two on one day don't overwrite each other", () => {
    expect(backupName(new Date(2026, 9, 11, 9, 5), "before-import")).toBe("budget-ctrl-2026-10-11-0905-before-import.json");
    expect(backupName(new Date(2026, 9, 11, 14, 32), "daily")).toBe("budget-ctrl-2026-10-11-1432-daily.json");
  });

  it("sorts in the order they were taken", () => {
    const names = [
      backupName(new Date(2026, 9, 11, 14, 32), "before-import"),
      backupName(new Date(2026, 9, 11, 9, 5), "daily"),
      backupName(new Date(2026, 9, 10, 23, 59), "daily"),
    ];
    expect([...names].sort()).toEqual([names[2], names[1], names[0]]);
  });
});

describe("parseBackupName", () => {
  it("reads the date, time and reason back", () => {
    expect(parseBackupName("budget-ctrl-2026-10-11-1432-before-update-0.5.1.json"))
      .toEqual({ date: "2026-10-11", time: "14:32", tag: "before-update-0.5.1" });
  });

  it("reads the names older versions wrote", () => {
    expect(parseBackupName("budget-ctrl-2026-10-11.json")).toEqual({ date: "2026-10-11", time: null, tag: "daily" });
    expect(parseBackupName("budget-ctrl-2026-10-11-before-import.json")).toEqual({ date: "2026-10-11", time: null, tag: "before-import" });
  });

  it("gives up on anything else", () => {
    expect(parseBackupName("notes.json")).toBe(null);
  });
});

describe("isBudgetText", () => {
  it("accepts a budget in any format the app can migrate", () => {
    expect(isBudgetText('{"months":{},"recurringTemplate":[]}')).toBe(true);
    expect(isBudgetText('{"expenses":[],"monthlyIncome":4000}')).toBe(true); // the oldest, flat format
  });

  it("rejects a file that is cut short, empty or something else", () => {
    expect(isBudgetText('{"months":{"2026-10":{"expenses":[{"na')).toBe(false);
    expect(isBudgetText("")).toBe(false);
    expect(isBudgetText("  \n")).toBe(false);
    expect(isBudgetText("null")).toBe(false);
    expect(isBudgetText("[]")).toBe(false);
    expect(isBudgetText(null)).toBe(false);
  });
});

describe("serial", () => {
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));

  it("runs one call at a time, in the order they were made", async () => {
    const order = [];
    const write = serial(async (v, ms) => { order.push(`start ${v}`); await tick(ms); order.push(`end ${v}`); });
    // The first write is the slowest: unqueued, it would finish last and win.
    await Promise.all([write("a", 30), write("b", 1), write("c", 1)]);
    expect(order).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("keeps going after a call fails, and reports that failure to its caller", async () => {
    const write = serial(async (v) => { if (v === "bad") throw new Error("disk full"); return v; });
    const results = await Promise.allSettled([write("bad"), write("good")]);
    expect(results[0].status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: "good" });
  });
});
