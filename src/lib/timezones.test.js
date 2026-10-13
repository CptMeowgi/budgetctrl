import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import process from "node:process";

// The suite runs in Warsaw, east of Greenwich, where reading "2026-10-25" as
// midnight in London still lands on the 25th. West of Greenwich it is the
// 24th. These run the date code in a separate Node process set to New York,
// so changing the time zone can't leak into other tests.
function inZone(tz, body) {
  const script = `process.env.TZ = ${JSON.stringify(tz)};\n${body}`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }));
}

describe("stored dates are read as local days, west of Greenwich too", () => {
  it("files a payday-dated entry in the period that starts that day", () => {
    const out = inZone("America/New_York", `
      const { periodKeyFor, monthKey } = await import("./src/lib/periods.js");
      console.log(JSON.stringify({ period: periodKeyFor("2026-10-25", 25), month: monthKey("2026-10-01") }));`);
    expect(out).toEqual({ period: "2026-10", month: "2026-10" });
  });

  it("doesn't settle a self-paying payment, or date its reminder, a day early", () => {
    const out = inZone("America/New_York", `
      const { upcomingSettled, collectDueBills } = await import("./src/lib/reminders.js");
      const today = new Date(2026, 9, 14, 12);
      const data = { cutoffDay: 1, months: { "2026-10": { recurring: [], credits: [], expenses: [],
        upcoming: [{ id: "u1", name: "Phone", amount: 25, dueDate: "2026-10-16" }] } } };
      console.log(JSON.stringify({
        settled: upcomingSettled({ autoPay: true, dueDate: "2026-10-15" }, today),
        reminder: collectDueBills(data, today, 7).map((b) => [b.dueISO, b.inDays]),
      }));`);
    expect(out).toEqual({ settled: false, reminder: [["2026-10-16", 2]] });
  });

  it("gives the same answers in Warsaw", () => {
    const out = inZone("Europe/Warsaw", `
      const { periodKeyFor, monthKey } = await import("./src/lib/periods.js");
      console.log(JSON.stringify({ period: periodKeyFor("2026-10-25", 25), month: monthKey("2026-10-01") }));`);
    expect(out).toEqual({ period: "2026-10", month: "2026-10" });
  });
});
