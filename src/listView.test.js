import { describe, it, expect } from "vitest";
import { filterAndSort } from "./listView.js";

describe("sorting by day", () => {
  it("puts a dated weekly copy by its date's day among monthly bills", () => {
    const rows = [{ name: "Rent", dayOfMonth: 20 }, { name: "Cleaner", date: "2026-10-09" }, { name: "Gym", dayOfMonth: 5 }];
    expect(filterAndSort(rows, { sorts: [{ col: "dayOfMonth", dir: "asc" }] }).map((r) => r.name)).toEqual(["Gym", "Cleaner", "Rent"]);
  });
});
