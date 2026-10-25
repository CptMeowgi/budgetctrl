import { describe, it, expect } from "vitest";
import { groupNames, groupRows, groupTotals, setCategoryGroup } from "./groups.js";

const data = () => ({
  categories: [
    { name: "Uncategorized" },
    { name: "Rent", group: "Bills" },
    { name: "Phone", group: "Bills" },
    { name: "Food", group: "Everyday" },
    { name: "Games", group: "Fun" },
    { name: "Gifts" },
  ],
  categoryGroups: ["Everyday", "Bills"],
});

describe("groupNames", () => {
  it("lists groups in use, in the order kept, then any others alphabetically", () => {
    expect(groupNames(data())).toEqual(["Everyday", "Bills", "Fun"]);
  });

  it("drops a kept group no category uses any more", () => {
    expect(groupNames({ ...data(), categoryGroups: ["Old", "Bills"] })).toEqual(["Bills", "Everyday", "Fun"]);
  });

  it("is empty for a budget without groups", () => {
    expect(groupNames({ categories: [{ name: "Food" }] })).toEqual([]);
  });
});

describe("groupRows", () => {
  const rows = [{ name: "Games", v: 1 }, { name: "Food", v: 2 }, { name: "Gifts", v: 3 }, { name: "Rent", v: 4 }, { name: "Phone", v: 5 }];

  it("sorts rows into their groups, keeping their order, with the ungrouped last", () => {
    expect(groupRows(rows, data()).map((g) => [g.group, g.rows.map((r) => r.name)])).toEqual([
      ["Everyday", ["Food"]], ["Bills", ["Rent", "Phone"]], ["Fun", ["Games"]], [null, ["Gifts"]],
    ]);
  });

  it("is one plain list when no category has a group", () => {
    expect(groupRows(rows, { categories: [] })).toEqual([{ group: null, rows }]);
  });

  it("leaves out a group with nothing in this list", () => {
    expect(groupRows([{ name: "Food" }], data()).map((g) => g.group)).toEqual(["Everyday"]);
  });
});

describe("groupTotals", () => {
  it("adds up totals, averages and each period", () => {
    const rows = [{ total: 10, average: 5, perPeriod: [4, 6] }, { total: 3, average: 1.5, perPeriod: [1, 2] }];
    expect(groupTotals(rows)).toEqual({ total: 13, average: 6.5, perPeriod: [5, 8] });
  });
});

describe("setCategoryGroup", () => {
  it("puts a category in a group, adding the group to the list when it's new", () => {
    const out = setCategoryGroup(data(), "Gifts", "Fun");
    expect(out.categories.find((c) => c.name === "Gifts").group).toBe("Fun");
    expect(out.categoryGroups).toEqual(["Everyday", "Bills", "Fun"]);
    const fresh = setCategoryGroup(data(), "Gifts", "  Presents ");
    expect(fresh.categories.find((c) => c.name === "Gifts").group).toBe("Presents");
    expect(fresh.categoryGroups).toEqual(["Everyday", "Bills", "Presents"]);
  });

  it("joins a group whatever its case, under the name it already has", () => {
    expect(setCategoryGroup(data(), "Gifts", "bills").categories.find((c) => c.name === "Gifts").group).toBe("Bills");
  });

  it("takes a category out of its group with an empty name", () => {
    const out = setCategoryGroup(data(), "Food", " ");
    expect("group" in out.categories.find((c) => c.name === "Food")).toBe(false);
  });
});
