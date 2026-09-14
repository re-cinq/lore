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

describe("a code review whose launch no cluster can perform (#2006: the renamed-repo visit that held the claim queue for hours)", () => {
  const UNREACHABLE =
    "There is at least one repository that does not exist or is not accessible to the parent installation.";

  it("fails the unlaunchable review on its first hand-back, and the next poll claims the review queued behind it", async () => {
    const h = createLineHarness();
    const hopeless = await h.start("code-review");
    const behind = await h.start("code-review");

    expect(await h.claimAndFailLaunchAs("central", UNREACHABLE)).toEqual({
      assemblyRunId: hopeless,
      status: "failed",
    });
    expect((await h.claimAs("central"))?.assemblyRunId).toBe(behind);
  });

  it("ends the unlaunchable review's run on the next reaper tick, naming the launch error", async () => {
    const h = createLineHarness();
    const hopeless = await h.start("code-review");

    await h.claimAndFailLaunchAs("central", UNREACHABLE);
    await h.reap();

    expect(await h.runs.getById(hopeless)).toMatchObject({
      status: "failed",
      reason: expect.stringContaining(
        "not accessible to the parent installation",
      ),
    });
  });

  it("fails a review on its third retryable hand-back, and the next reaper tick spends the line's own retry on a fresh review visit", async () => {
    const h = createLineHarness();

    await h.start("code-review");
    const statuses: Array<string | undefined> = [];

    for (const round of [1, 2, 3]) {
      const released = await h.claimAndFailLaunchAs(
        "central",
        `image pull timed out, round ${round}`,
      );

      statuses.push(released?.status);
    }
    await h.reap();

    expect(statuses).toEqual(["requeued", "requeued", "failed"]);
    expect(h.visits()).toEqual([
      ["review", "failed"],
      ["review", null],
    ]);
  });
});
