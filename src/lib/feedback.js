// Links to the project's GitHub issue forms, with the app version and system
// filled in. Nothing else goes in the address: no budget data, nothing about
// the person sending it.

export const REPO_URL = "https://github.com/CptMeowgi/budgetctrl";

// kind: "problem" or "idea". The query parameters fill the form fields with
// the same ids in .github/ISSUE_TEMPLATE; the idea form doesn't ask for the
// system.
export function issueUrl(kind, { version, os } = {}) {
  const params = new URLSearchParams({ template: kind === "idea" ? "feature_request.yml" : "bug_report.yml" });
  if (version) params.set("version", version);
  if (os && kind !== "idea") params.set("os", os);
  return `${REPO_URL}/issues/new?${params}`;
}
