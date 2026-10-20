import { describe, it, expect } from "vitest";
import { allDestinations, moveSelection, paletteItems } from "./palette-items";

describe("paletteItems", () => {
  it("lists every nav destination, then settings and add repo, for an empty query", () => {
    const hrefs = paletteItems("").map((entry) => entry.href);

    expect(hrefs).toEqual(allDestinations().map((entry) => entry.href));
    expect(hrefs.slice(-2)).toEqual(["/settings", "/onboard"]);
  });

  it("keeps the destinations whose label holds the query, then offers a search for it", () => {
    const labels = paletteItems("spe").map((entry) => entry.label);

    expect(labels).toEqual(["Specs", "Spend", "Search for “spe”"]);
  });

  it("sends the search entry to /search with the query encoded", () => {
    const search = paletteItems("rate limit").at(-1);

    expect(search?.href).toBe("/search?q=rate%20limit");
  });
});

describe("moveSelection", () => {
  it("wraps from the last entry to the first and back", () => {
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});
