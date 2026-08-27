// Acceptance: the REAL code-review blueprint walked through the real handlers,
// with the node executed by a SATELLITE — a cluster whose Agent CRs the central
// Floor cannot read.
//
// On 2026-08-27 every review on this repo failed with "the review posted no
// findings and reached no verdict — it never got far enough to judge the diff",
// while the agent's own output ended in `REVIEW_RESULT:APPROVED`. The central
// cluster was paused, every node was claimed by a satellite, and the read-back
// `readAgentStatus` answers null for a CR in another cluster. That null was
// degraded into "the agent produced nothing" and posted as a verdict.
//
// No pr_number here on purpose: the review post and the PR check both no-op
// without one, so this walks the visibility decision with no GitHub in reach.

import { describe, it, expect } from "vitest";
import { createLineHarness } from "./line-acceptance-harness.js";

const SATELLITE = "satellite-1";

describe("code-review walked by a satellite", () => {
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
});
