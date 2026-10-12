import { describe, it, expect } from "vitest";
import { choices } from "./licenses.js";

describe("licence expressions", () => {
  it("reads a choice of licences", () => {
    expect(choices("MIT OR Apache-2.0")).toEqual([["MIT"], ["Apache-2.0"]]);
    expect(choices("MIT/Apache-2.0")).toEqual([["MIT"], ["Apache-2.0"]]);
    expect(choices("Apache-2.0 / MIT")).toEqual([["Apache-2.0"], ["MIT"]]);
  });

  it("keeps licences that all apply together", () => {
    expect(choices("BSD-3-Clause AND MIT")).toEqual([["BSD-3-Clause", "MIT"]]);
    // A choice, plus a licence that applies whichever is chosen.
    expect(choices("(MIT OR Apache-2.0) AND Unicode-3.0")).toEqual([["MIT", "Unicode-3.0"], ["Apache-2.0", "Unicode-3.0"]]);
  });

  it("binds AND tighter than OR", () => {
    expect(choices("MIT OR Apache-2.0 AND ISC")).toEqual([["MIT"], ["Apache-2.0", "ISC"]]);
  });

  it("drops exceptions, which only add permissions", () => {
    expect(choices("Apache-2.0 WITH LLVM-exception OR MIT")).toEqual([["Apache-2.0"], ["MIT"]]);
  });

  it("has nothing to offer for an empty licence field", () => {
    expect(choices("")).toEqual([]);
    expect(choices(undefined)).toEqual([]);
  });
});
