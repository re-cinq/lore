import { describe, it, expect } from "vitest";
import { planPageState } from "./plan-page-state";

const visit = (nodeId: string, outcome: string | null, iteration = 1) => ({
  nodeId,
  iteration,
  outcome,
});

const run = (
  status: string,
  nodes: ReturnType<typeof visit>[],
  extra: { outcome?: string | null; prUrl?: string | null } = {},
) => ({
  status,
  outcome: extra.outcome ?? null,
  reason: null,
  prUrl: extra.prUrl ?? null,
  nodes,
});

describe("planPageState for a draft plan", () => {
  it("is drafting while the run is queued", () => {
    expect(planPageState("draft", run("queued", []))).toBe("drafting");
  });

  it("is writing while the line waits on the author, and after a run that failed before approval", () => {
    expect([
      planPageState("draft", run("running", [visit("author", null)])),
      planPageState("draft", run("failed", [visit("analyze", "failed")])),
      planPageState("draft", null),
    ]).toEqual(["writing", "writing", "writing"]);
  });

  it("is refining while analyze runs again for a section", () => {
    expect(
      planPageState(
        "draft",
        run("running", [
          visit("author", "changes_requested"),
          visit("analyze", null, 2),
        ]),
      ),
    ).toBe("refining");
  });

  it("is reopened while the line waits on the author with spec PR #7 already open", () => {
    expect(
      planPageState(
        "draft",
        run(
          "running",
          [visit("merged", "changes_requested"), visit("author", null)],
          {
            prUrl: "https://github.com/re-cinq/lore/pull/7",
          },
        ),
      ),
    ).toBe("reopened");
  });
});

describe("planPageState for a plan reopened by its line", () => {
  it("is answering while the reopened plan's line waits on the author after the spec analysis's question", () => {
    expect(
      planPageState(
        "draft",
        run("running", [
          visit("author", "success"),
          visit("analyse-specs", "changes_requested"),
          visit("author", null, 2),
        ]),
      ),
    ).toBe("answering");
  });
});

describe("planPageState for an approved plan", () => {
  it("is spec-work while analyse-specs, write or push runs", () => {
    expect(
      ["analyse-specs", "write", "push"].map((node) =>
        planPageState("approved", run("running", [visit(node, null)])),
      ),
    ).toEqual(["spec-work", "spec-work", "spec-work"]);
  });

  it("is spec-pr-open while the merged node is parked", () => {
    expect(
      planPageState("approved", run("running", [visit("merged", null)])),
    ).toBe("spec-pr-open");
  });

  it("is question while the line came back to the author", () => {
    expect(
      planPageState(
        "approved",
        run("running", [
          visit("analyse-specs", "changes_requested"),
          visit("author", null),
        ]),
      ),
    ).toBe("question");
  });

  it("is spec-work-failed after a run that failed or ended short of completing, and with no run at all", () => {
    expect([
      planPageState("approved", run("failed", [visit("push", "success")])),
      planPageState(
        "approved",
        run("finished", [], { outcome: "iteration_max" }),
      ),
      planPageState("approved", null),
    ]).toEqual(["spec-work-failed", "spec-work-failed", "spec-work-failed"]);
  });

  it("is delivering while decompose or issues runs, and delivered once the run completed", () => {
    expect([
      planPageState("approved", run("running", [visit("decompose", null)])),
      planPageState("approved", run("running", [visit("issues", null)])),
      planPageState("approved", run("finished", [], { outcome: "completed" })),
    ]).toEqual(["delivering", "delivering", "delivered"]);
  });
});
