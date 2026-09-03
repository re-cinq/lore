import { describe, it, expect } from "vitest";
import { createLineHarness } from "./line-acceptance-harness.js";

const SATELLITE = "satellite-1";

describe("code-review walked by a satellite whose Agent CRs the central Floor cannot read (readAgentStatus answers null, reproducing the 2026-08-27 outage where an APPROVED verdict was lost; no pr_number so review-post/PR-check no-op and only the visibility decision is exercised — fixed for real by FR4's satellite self-report)", () => {
  it("does not finish the node when the satellite's CR is unreadable", async () => {
    const h = createLineHarness();
    const id = await h.start("code-review");

    await h.completeAgentNode(id, "review", {
      claimedBy: SATELLITE,
      statusUnreadable: true,
    });

    expect(h.visits()).toEqual([["review", null]]);
  });

  it("leaves the run open when the satellite's CR is unreadable", async () => {
    const h = createLineHarness();
    const id = await h.start("code-review");

    await h.completeAgentNode(id, "review", {
      claimedBy: SATELLITE,
      statusUnreadable: true,
    });

    expect(await h.runs.getById(id)).toMatchObject({
      status: "running",
      outcome: null,
    });
  });

  it("finishes the node when the central cluster's CR is readable", async () => {
    const h = createLineHarness();
    const id = await h.start("code-review");

    await h.completeAgentNode(id, "review", { outcome: "success" });

    expect(h.visits()).toEqual([["review", "success"]]);
  });

  it("finishes the node from the satellite's own reported status, unreadable or not", async () => {
    const h = createLineHarness();
    const id = await h.start("code-review");

    await h.completeAgentNode(id, "review", {
      claimedBy: SATELLITE,
      statusUnreadable: true,
      reportStatus: true,
      outcome: "success",
    });

    expect(h.visits()).toEqual([["review", "success"]]);
    expect(await h.runs.getById(id)).toMatchObject({ status: "finished" });
  });

  it("records a changes_requested verdict from a satellite's reported status", async () => {
    const h = createLineHarness();
    const id = await h.start("code-review");

    await h.completeAgentNode(id, "review", {
      claimedBy: SATELLITE,
      statusUnreadable: true,
      reportStatus: true,
      outcome: "changes_requested",
    });

    expect(h.visits()).toEqual([["review", "changes_requested"]]);
  });
});
