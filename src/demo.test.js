import { describe, it, expect } from "vitest";
import { fortnightlyDemo } from "./demo.js";
import { calendarFor } from "./lib/calendar.js";
import { copiesFor } from "./lib/occurrences.js";

describe("the fortnightly demo", () => {
  const today = new Date(2026, 9, 15, 12);
  const data = fortnightlyDemo(today);
  const cal = calendarFor(data);

  it("switched to fortnights about two months ago, keeping the months before", () => {
    const keys = Object.keys(data.months).sort();
    expect(keys.some((k) => cal.kindOf(k) === "monthly")).toBe(true);
    expect(keys.filter((k) => cal.kindOf(k) === "weeks").length).toBeGreaterThanOrEqual(4);
    expect(keys[keys.length - 1]).toBe(cal.current(today));
  });

  it("keys every period as its calendar does, with nothing missing in between", () => {
    const keys = Object.keys(data.months).sort();
    for (let i = 1; i < keys.length; i++) expect(cal.next(keys[i - 1])).toBe(keys[i]);
    for (const k of keys) expect(cal.keyFor(cal.range(k).start)).toBe(k);
  });

  it("files every entry in the period its date falls in, and gives each period its bills", () => {
    for (const [k, m] of Object.entries(data.months)) {
      for (const e of m.expenses) expect(cal.keyFor(e.date)).toBe(k);
      expect(m.recurring.map((r) => r.templateId)).toEqual(data.recurringTemplate.flatMap((t) => copiesFor(t, cal, k, () => "").map(() => t.id)));
    }
  });
});
