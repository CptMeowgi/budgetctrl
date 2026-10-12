import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { issueUrl, REPO_URL } from "./feedback.js";

describe("issueUrl", () => {
  it("opens the problem form with the version and system filled in", () => {
    const url = new URL(issueUrl("problem", { version: "0.5.3", os: "Windows" }));
    expect(`${url.origin}${url.pathname}`).toBe(`${REPO_URL}/issues/new`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ template: "bug_report.yml", version: "0.5.3", os: "Windows" });
  });

  it("opens the idea form, which doesn't ask for the system", () => {
    expect(Object.fromEntries(new URL(issueUrl("idea", { version: "0.5.3", os: "Windows" })).searchParams))
      .toEqual({ template: "feature_request.yml", version: "0.5.3" });
  });

  it("leaves out what it doesn't know", () => {
    expect(Object.fromEntries(new URL(issueUrl("problem")).searchParams)).toEqual({ template: "bug_report.yml" });
  });

  it("names forms and fields that exist", () => {
    for (const [kind, file] of [["problem", "bug_report.yml"], ["idea", "feature_request.yml"]]) {
      const form = readFileSync(`.github/ISSUE_TEMPLATE/${file}`, "utf8");
      const ids = [...form.matchAll(/^\s+id: ([\w-]+)\s*$/gm)].map((m) => m[1]);
      const filled = [...new URL(issueUrl(kind, { version: "1", os: "x" })).searchParams.keys()].filter((k) => k !== "template");
      for (const field of filled) expect(ids).toContain(field);
    }
  });
});
