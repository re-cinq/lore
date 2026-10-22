import { describe, expect, it } from "vitest";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import { ticketsListing } from "./listing.js";

const ISSUE: IssueRef = {
  repo: "acme/widgets",
  number: 12,
  title: "T001: Add the parser",
  state: "closed",
  labels: ["lore-managed"],
  body: "long body",
};

describe("ticketsListing", () => {
  it("lists a filed task by its id, title, issue number and state, without the body", () => {
    expect(ticketsListing(new Map([["T001", ISSUE]]))).toEqual([
      {
        id: "T001",
        title: "T001: Add the parser",
        number: 12,
        state: "closed",
      },
    ]);
  });

  it("is empty for a spec nothing was filed for", () => {
    expect(ticketsListing(new Map())).toEqual([]);
  });
});
