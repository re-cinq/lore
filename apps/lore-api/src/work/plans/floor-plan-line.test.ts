import { describe, expect, it } from "vitest";
import { floorPlanVerbs } from "./floor-plan-verbs.js";
import type { Report, RunView, VisitView } from "@re-cinq/floor-client";
import {
  PLAN_BLOB_HASH,
  planRun,
  planVisit,
  recordedPlanFloor,
} from "@re-cinq/lore-shared/floor/recorded-plan-floor.js";
import type { FloorRequest } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import {
  approveFloorPlan,
  askFloorRefine,
  decideFloorApproval,
  reopenFloorPlan,
  reworkFloorSpec,
  startFloorDrafting,
  startFloorSpecWork,
  validateFloorPlan,
  type FloorPlanDeps,
} from "./floor-plan-line.js";
import type { SpecReviewReads } from "./spec-rework.js";
import { specBranchOf } from "./spec-branch.js";

const DRAFT = {
  id: "p1",
  repo: "re-cinq/lore",
  title: "Faster checkout",
  status: "draft",
};
const APPROVED = { ...DRAFT, status: "approved" };
const MARKDOWN = "# Faster checkout\n\nCheckout is slow.\n";
const BRIEF = 'Draft the plan "Widget" in plan.md.';
const SUCCESS: Report = { outcome: "success" };
const SPEC_PR_URL = "https://github.com/re-cinq/lore/pull/12";

const REFINE = {
  slot: "intent",
  title: "Intent",
  baseHash: "3f9a",
  inputs: {},
  uses: { answers: ["a1"] },
};

const ON_AUTHOR = [
  planVisit("analyze", SUCCESS),
  planVisit("plan-pass-end", SUCCESS),
  planVisit("author", null),
];
const WHILE_ANALYZING = [
  planVisit("author", SUCCESS),
  planVisit("analyze", null),
];
const WHILE_WRITING = [planVisit("author", SUCCESS), planVisit("write", null)];
const ON_MERGED = [
  planVisit("author", SUCCESS),
  planVisit("open-spec-pr", {
    outcome: "success",
    produced: { pr_url: SPEC_PR_URL },
  }),
  planVisit("merged", null),
];

const REVIEWED: SpecReviewReads = {
  listReviewThreads: async () => [],
  listComments: async () => [],
  listReviews: async () =>
    [
      { id: 9, state: "CHANGES_REQUESTED", body: "Split FR3.", user: "ana" },
    ] as never,
};
const SILENT: SpecReviewReads = {
  listReviewThreads: async () => [],
  listComments: async () => [],
  listReviews: async () => [],
};

function scene(
  given: {
    runs?: RunView[];
    visits?: VisitView[];
    pulls?: SpecReviewReads;
  } = {},
) {
  const recorded = recordedPlanFloor({
    runs: given.runs ?? [planRun()],
    visits: { "run-open": given.visits ?? [] },
  });
  const branchesFor: string[] = [];
  const deps: FloorPlanDeps = {
    floor: recorded.floor,
    specBranch: async (plan) => (branchesFor.push(plan.id), specBranchOf(plan)),
    baseBranch: () => Promise.resolve("main"),
    pulls: given.pulls ?? REVIEWED,
  };

  return { deps, requests: recorded.requests, branchesFor };
}

const NO_RUN = { runs: [] };
const FINISHED = planRun({
  outcome: "success",
  finishedAt: "2026-10-01T10:00:00.000Z",
});

function posts(requests: FloorRequest[]): FloorRequest[] {
  return requests.filter((request) => request.method === "POST");
}

function reportedProduced(
  requests: FloorRequest[],
): Record<string, string | undefined> {
  const last = posts(requests).at(-1)?.body as {
    payload?: { report?: { produced?: Record<string, string> } };
  };

  return last?.payload?.report?.produced ?? {};
}

function reported(visitId: string, report: Report): FloorRequest {
  return {
    method: "POST",
    path: "/events",
    body: {
      name: "station_run.reported",
      payload: { visitId, worker: "lore", report },
      dedupeKey: `station_run.reported:${visitId}`,
    },
  };
}

function started(entry?: string): FloorRequest {
  return {
    method: "POST",
    path: "/assembly-lines/feature-planning/start",
    body: {
      repo: "github.com/re-cinq/lore",
      startItems: {
        repo: {
          kind: "git",
          ref: "github.com/re-cinq/lore@lore/feature-planning/p1",
          by: "lore",
        },
        base: {
          kind: "git",
          ref: "github.com/re-cinq/lore@main",
          by: "lore",
        },
        plan_id: { kind: "value", ref: "p1", by: "lore" },
        plan_title: { kind: "value", ref: "Faster checkout", by: "lore" },
        plan_md: { kind: "file", ref: PLAN_BLOB_HASH, by: "lore" },
        description: { kind: "value", ref: BRIEF, by: "lore" },
      },
      ...(entry ? { entry } : {}),
    },
  };
}

describe("startFloorDrafting", () => {
  it("reports changes_requested on the author visit with plan.md and no refine when the run waits on author", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });

    const runId = await startFloorDrafting(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(runId).toBe("run-open");
    expect(posts(requests).at(-1)).toEqual(
      reported("visit-author", {
        outcome: "changes_requested",
        produced: { plan_md: PLAN_BLOB_HASH, description: BRIEF },
      }),
    );
  });

  it("stores the plan's markdown as the plan.md blob the agent downloads", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });

    await startFloorDrafting(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(posts(requests)[0]).toMatchObject({
      path: "/blobs",
      body: MARKDOWN,
    });
  });

  it("starts feature-planning on the plan's spec branch with its id, title and plan.md when no run exists", async () => {
    const { deps, requests, branchesFor } = scene(NO_RUN);

    const runId = await startFloorDrafting(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(runId).toBe("run-new");
    expect(posts(requests).at(-1)).toEqual(started());
    expect(branchesFor).toEqual(["p1"]);
  });

  it("starts a fresh run when the last run finished", async () => {
    const { deps, requests } = scene({ runs: [FINISHED] });

    await startFloorDrafting(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(posts(requests).at(-1)).toEqual(started());
  });

  it("answers the open run it joined while its agent is at work", async () => {
    const { deps } = scene({ visits: WHILE_ANALYZING });

    const runId = await startFloorDrafting(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(runId).toBe("run-open");
  });
});

describe("askFloorRefine", () => {
  it("reports changes_requested on the author visit with plan.md and the refine slot intent read at 3f9a", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });

    await askFloorRefine(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
      refine: REFINE,
    });

    expect(posts(requests).at(-1)).toEqual(
      reported("visit-author", {
        outcome: "changes_requested",
        produced: {
          plan_md: PLAN_BLOB_HASH,
          refine:
            '{"slot":"intent","baseHash":"3f9a","uses":{"answers":["a1"]}}',
          description: BRIEF,
        },
      }),
    );
  });

  it("refuses with 409 while the planning agent is still working on this plan, reporting nothing", async () => {
    const { deps, requests } = scene({ visits: WHILE_ANALYZING });

    await expect(
      askFloorRefine(deps, {
        plan: DRAFT,
        planMarkdown: MARKDOWN,
        brief: BRIEF,
        refine: REFINE,
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the planning agent is still working on this plan",
    });
    expect(posts(requests)).toEqual([]);
  });

  it("refuses with 409 a plan the floor holds no run for", async () => {
    const { deps } = scene(NO_RUN);

    await expect(
      askFloorRefine(deps, {
        plan: DRAFT,
        planMarkdown: MARKDOWN,
        brief: BRIEF,
        refine: REFINE,
      }),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
  });

  it("refuses a Refine on draft plan p1 with 409 naming why for each state its floor run is in, reporting nothing", async () => {
    const scenes = {
      noRun: NO_RUN,
      specWorkFailed: { runs: [FAILED], visits: AFTER_FAILED_SPECS },
      cancelled: { runs: [CANCELLED], visits: WHILE_ANALYZING },
      delivered: { runs: [FINISHED], visits: DELIVERED },
      specPrOpen: { visits: ON_MERGED },
      whileAnalyzing: { visits: WHILE_ANALYZING },
      settlingThePass: { visits: SETTLING_PASS },
      writingSpecs: { visits: WHILE_WRITING },
      decomposing: { visits: DECOMPOSING },
    };

    expect(await refusalsOf(DRAFT, scenes)).toEqual({
      refusals: {
        noRun:
          "409: the plan has no planning line yet; regenerate the plan to start one",
        specWorkFailed:
          "409: the planning line failed, so no agent is waiting to refine this plan; regenerate the plan to draft it again",
        cancelled:
          "409: the planning line failed, so no agent is waiting to refine this plan; regenerate the plan to draft it again",
        delivered:
          "409: the planning line has ended, so no agent is waiting to refine this plan; edit the section by hand",
        specPrOpen:
          "409: the spec PR is being sent back to the author; try again in a moment",
        whileAnalyzing: "409: the planning agent is still working on this plan",
        settlingThePass:
          "409: the planning agent is still working on this plan",
        writingSpecs: "409: the specs are being written; wait for the spec PR",
        decomposing: "409: wait until the spec-tasks are filed",
      },
      reported: 0,
    });
  });

  it("names Retry and Reopen, never Regenerate, when approved plan p1 is refined on the floor, as its read-only page offers them", async () => {
    const scenes = {
      noRun: NO_RUN,
      specWorkFailed: { runs: [FAILED], visits: AFTER_FAILED_SPECS },
      delivered: { runs: [FINISHED], visits: DELIVERED },
      specPrOpen: { visits: ON_MERGED },
      writingSpecs: { visits: WHILE_WRITING },
      decomposing: { visits: DECOMPOSING },
    };

    expect(await refusalsOf(APPROVED, scenes)).toEqual({
      refusals: {
        noRun:
          "409: the plan is approved and its spec work failed; retry the spec work, or reopen the plan to write again",
        specWorkFailed:
          "409: the plan is approved and its spec work failed; retry the spec work, or reopen the plan to write again",
        delivered:
          "409: the plan is approved, so its sections are settled; reopen the plan to write again",
        specPrOpen:
          "409: the plan is approved, so its sections are settled; reopen the plan to write again",
        writingSpecs: "409: the specs are being written; wait for the spec PR",
        decomposing: "409: wait until the spec-tasks are filed",
      },
      reported: 0,
    });
  });
});

const FAILED = planRun({
  outcome: "failed",
  finishedAt: "2026-10-01T10:00:00.000Z",
});
const CANCELLED = planRun({
  outcome: "cancelled",
  finishedAt: "2026-10-01T10:00:00.000Z",
});
const AFTER_FAILED_SPECS = [
  planVisit("author", SUCCESS),
  planVisit("analyse-specs", { outcome: "failed" }),
];
const DELIVERED = [
  planVisit("author", SUCCESS),
  planVisit("merged", SUCCESS),
  planVisit("decompose", SUCCESS),
];
const SETTLING_PASS = [
  planVisit("analyze", SUCCESS),
  planVisit("plan-pass-end", null),
];
const DECOMPOSING = [
  planVisit("merged", SUCCESS),
  planVisit("decompose", null),
];

async function refusalsOf(
  plan: typeof DRAFT,
  scenes: Record<string, Parameters<typeof scene>[0]>,
) {
  const answers = await Promise.all(
    Object.entries(scenes).map(async ([state, given]) => {
      const { deps, requests } = scene(given);
      const refusal = await askFloorRefine(deps, {
        plan,
        planMarkdown: MARKDOWN,
        brief: BRIEF,
        refine: REFINE,
      })
        .then(() => "resumed")
        .catch(
          (error: Error & { output?: { statusCode: number } }) =>
            `${error.output?.statusCode}: ${error.message}`,
        );

      return [state, refusal, posts(requests).length] as const;
    }),
  );

  return {
    refusals: Object.fromEntries(
      answers.map(([state, refusal]) => [state, refusal]),
    ),
    reported: answers.reduce((sum, [, , reported]) => sum + reported, 0),
  };
}

describe("approveFloorPlan", () => {
  it("reports success on the author visit with the approved plan.md when the run waits on author", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });

    const decision = await approveFloorPlan(deps, {
      plan: APPROVED,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(decision).toEqual({ kind: "hand-over" });
    expect(posts(requests).at(-1)).toEqual(
      reported("visit-author", {
        outcome: "success",
        produced: { plan_md: PLAN_BLOB_HASH, description: BRIEF },
      }),
    );
  });

  it("starts a fresh run entered at analyse-specs when the floor holds no run", async () => {
    const { deps, requests } = scene(NO_RUN);

    const decision = await approveFloorPlan(deps, {
      plan: APPROVED,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(decision).toEqual({ kind: "start-spec-work" });
    expect(posts(requests).at(-1)).toEqual(started("analyse-specs"));
  });

  it("starts a fresh run entered at analyse-specs when the last run finished", async () => {
    const { deps, requests } = scene({ runs: [FINISHED] });

    await approveFloorPlan(deps, {
      plan: APPROVED,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(posts(requests).at(-1)).toEqual(started("analyse-specs"));
  });

  it("sends nothing and answers refused while the agent refines a section", async () => {
    const { deps, requests } = scene({ visits: WHILE_ANALYZING });

    const decision = await approveFloorPlan(deps, {
      plan: APPROVED,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(decision).toEqual({
      kind: "refused",
      reason: "the planning agent is still refining a section",
    });
    expect(posts(requests)).toEqual([]);
  });
});

describe("the round's brief the floor's planning agent is given", () => {
  it("names the section the Refine asks about in the brief the agent is given", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });
    const verbs = floorPlanVerbs(deps, () => Promise.resolve(MARKDOWN));

    await verbs.refine(DRAFT, REFINE);

    expect(reportedProduced(requests).description).toContain(
      "<!-- slot:intent -->",
    );
  });

  it("tells the agent what the plan's author already knows on a first draft", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });
    const verbs = floorPlanVerbs(deps, () => Promise.resolve(MARKDOWN));

    await verbs.draft(DRAFT, {
      known: "checkout drops carts",
      createdBy: "gedaiu",
    });

    expect(reportedProduced(requests).description).toContain(
      "checkout drops carts",
    );
  });
});

describe("decideFloorApproval", () => {
  it("refuses with the specs are being written while the run is on write", async () => {
    const { deps } = scene({ visits: WHILE_WRITING });

    expect(await decideFloorApproval(deps, APPROVED)).toEqual({
      kind: "refused",
      reason: "the specs are being written",
    });
  });

  it("hands over a run waiting on its author, asking the floor nothing to write", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });

    expect(await decideFloorApproval(deps, DRAFT)).toEqual({
      kind: "hand-over",
    });
    expect(posts(requests)).toEqual([]);
  });
});

describe("startFloorSpecWork", () => {
  it("starts a fresh run entered at analyse-specs for an approved plan whose run finished", async () => {
    const { deps, requests } = scene({ runs: [FINISHED] });

    const runId = await startFloorSpecWork(deps, {
      plan: APPROVED,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(runId).toBe("run-new");
    expect(posts(requests).at(-1)).toEqual(started("analyse-specs"));
  });

  it("refuses with 409 the spec work is already running while the run is on write", async () => {
    const { deps } = scene({ visits: WHILE_WRITING });

    await expect(
      startFloorSpecWork(deps, {
        plan: APPROVED,
        planMarkdown: MARKDOWN,
        brief: BRIEF,
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the spec work is already running",
    });
  });

  it("refuses with 409 the plan is not approved for a draft plan", async () => {
    const { deps } = scene(NO_RUN);

    await expect(
      startFloorSpecWork(deps, {
        plan: DRAFT,
        planMarkdown: MARKDOWN,
        brief: BRIEF,
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the plan is not approved",
    });
  });
});

describe("reopenFloorPlan", () => {
  it("reports changes_requested on the merged visit when the run waits on its spec PR", async () => {
    const { deps, requests } = scene({ visits: ON_MERGED });

    await reopenFloorPlan(deps, APPROVED);

    expect(posts(requests)).toEqual([
      reported("visit-merged", { outcome: "changes_requested" }),
    ]);
  });

  it("reports nothing when the run already waits on its author", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });

    await reopenFloorPlan(deps, APPROVED);

    expect(posts(requests)).toEqual([]);
  });

  it("refuses with 409 while the specs are being written and the spec PR is not open", async () => {
    const { deps } = scene({ visits: WHILE_WRITING });

    await expect(reopenFloorPlan(deps, APPROVED)).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the specs are being written; wait for the spec PR",
    });
  });
});

describe("validateFloorPlan", () => {
  it("posts manual.plan.validate naming run-open and gedaiu when the draft plan waits on author", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });

    const runId = await validateFloorPlan(deps, {
      plan: DRAFT,
      actor: "gedaiu",
    });

    expect(runId).toBe("run-open");
    expect(posts(requests)).toEqual([
      {
        method: "POST",
        path: "/events",
        body: {
          name: "manual.plan.validate",
          payload: { runId: "run-open", requestedBy: "gedaiu" },
        },
      },
    ]);
  });

  it("refuses with 409 while the planning agent is still working", async () => {
    const { deps, requests } = scene({ visits: WHILE_ANALYZING });

    await expect(
      validateFloorPlan(deps, { plan: DRAFT, actor: "gedaiu" }),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
    expect(posts(requests)).toEqual([]);
  });

  it("refuses with 409 a plan with no run on the floor", async () => {
    const { deps } = scene(NO_RUN);

    await expect(
      validateFloorPlan(deps, { plan: DRAFT, actor: "gedaiu" }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the plan has no planning line yet",
    });
  });
});

describe("reworkFloorSpec", () => {
  it("posts node.write.start naming run-open and gedaiu when spec PR 12 has an unresolved review", async () => {
    const { deps, requests } = scene({ visits: ON_MERGED });

    const runId = await reworkFloorSpec(deps, {
      plan: APPROVED,
      actor: "gedaiu",
    });

    expect(runId).toBe("run-open");
    expect(posts(requests)).toEqual([
      {
        method: "POST",
        path: "/events",
        body: {
          name: "node.write.start",
          payload: { runId: "run-open", requestedBy: "gedaiu" },
        },
      },
    ]);
  });

  it("refuses with 409 when nothing on the spec PR is waiting for the writer", async () => {
    const { deps, requests } = scene({ visits: ON_MERGED, pulls: SILENT });

    await expect(
      reworkFloorSpec(deps, { plan: APPROVED, actor: "gedaiu" }),
    ).rejects.toMatchObject({ output: { statusCode: 409 } });
    expect(posts(requests)).toEqual([]);
  });

  it("refuses with 409 the spec PR is not waiting for review while the run waits on its author", async () => {
    const { deps } = scene({ visits: ON_AUTHOR });

    await expect(
      reworkFloorSpec(deps, { plan: APPROVED, actor: "gedaiu" }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the spec PR is not waiting for review",
    });
  });
});

describe("floorPlanVerbs", () => {
  it("hands the markdown read for plan p1 to the run it starts as the plan.md blob", async () => {
    const { deps, requests } = scene(NO_RUN);
    const reads: string[] = [];
    const verbs = floorPlanVerbs(
      deps,
      async (planId) => (reads.push(planId), MARKDOWN),
    );

    await verbs.draft(DRAFT, {
      known: "Checkout is slow.",
      createdBy: "gedaiu",
    });

    expect(reads).toEqual(["p1"]);
    expect(posts(requests)[0]).toMatchObject({
      path: "/blobs",
      body: MARKDOWN,
    });
  });

  it("reopens an approved plan whose run waits on its author and says it did", async () => {
    const { deps } = scene({ visits: ON_AUTHOR });
    const reopened: string[] = [];
    const verbs = floorPlanVerbs(deps, async () => MARKDOWN);

    const locked = await verbs.openForAuthor(APPROVED, async (planId) =>
      reopened.push(planId),
    );

    expect(locked).toBe(true);
    expect(reopened).toEqual(["p1"]);
  });
});
