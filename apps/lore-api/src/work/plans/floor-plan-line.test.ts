import { describe, expect, it } from "vitest";
import { reworkFloorSpec, validateFloorPlan } from "./floor-plan-by-hand.js";
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
  startFloorDrafting,
  startFloorSpecWork,
  type FloorPlanDeps,
} from "./floor-plan-line.js";
import type { RefineAsk } from "./refine-asks.js";
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
  actor: "ana",
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
    specPrState?: "open" | "closed" | "merged" | null;
  } = {},
) {
  const recorded = recordedPlanFloor({
    runs: given.runs ?? [planRun()],
    visits: { "run-open": given.visits ?? [] },
  });
  const branchesFor: string[] = [];
  const asks: RefineAsk[] = [];
  const deps: FloorPlanDeps = {
    floor: recorded.floor,
    specBranch: async (plan) => (branchesFor.push(plan.id), specBranchOf(plan)),
    baseBranch: () => Promise.resolve("main"),
    specPrState: () => Promise.resolve(given.specPrState ?? null),
    pulls: given.pulls ?? REVIEWED,
    recordRefineAsk: async (ask) => {
      asks.push(ask);
    },
  };

  return { deps, requests: recorded.requests, branchesFor, asks };
}

const NO_RUN = { runs: [] };
const FINISHED = planRun({
  outcome: "success",
  finishedAt: "2026-10-01T10:00:00.000Z",
});

function posts(requests: FloorRequest[]): FloorRequest[] {
  return requests.filter((request) => request.method === "POST");
}

function startedItem(requests: FloorRequest[], name: string): unknown {
  const body = posts(requests).at(-1)?.body as {
    startItems?: Record<string, unknown>;
  };

  return body?.startItems?.[name];
}

function startedDescription(requests: FloorRequest[]): string {
  const body = posts(requests).at(-1)?.body as {
    startItems?: { description?: { ref?: string } };
  };

  return body?.startItems?.description?.ref ?? "";
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
  it("reports changes_requested on the author visit with the plan.md a draft answers with", async () => {
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
  it("posts a bare analyze start on the plan's run and records the ask, with the author waiting", async () => {
    const { deps, requests, asks } = scene({ visits: ON_AUTHOR });

    await askFloorRefine(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
      refine: REFINE,
      actor: "ana",
    });

    expect({ post: posts(requests).at(-1), asks }).toEqual({
      post: {
        method: "POST",
        path: "/events",
        body: {
          name: "node.analyze.start",
          payload: { runId: "run-open", requestedBy: "ana" },
        },
      },
      asks: [
        {
          planId: "p1",
          slot: "intent",
          title: "Intent",
          baseHash: "3f9a",
          inputs: {},
          uses: { answers: ["a1"] },
          brief: BRIEF,
        },
      ],
    });
  });

  it("carries no refine value in the run's bag, since the ask is read from lore-api", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });

    await askFloorRefine(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
      refine: REFINE,
      actor: "ana",
    });

    expect(JSON.stringify(posts(requests))).not.toContain("3f9a");
  });

  it("refuses with 409 while an analyze visit is open, so two agents never edit one plan, recording no ask", async () => {
    const { deps, requests, asks } = scene({ visits: WHILE_ANALYZING });

    await expect(
      askFloorRefine(deps, {
        plan: DRAFT,
        planMarkdown: MARKDOWN,
        brief: BRIEF,
        refine: REFINE,
        actor: "ana",
      }),
    ).rejects.toMatchObject({
      output: { statusCode: 409 },
      message: "the planning agent is still working on this plan",
    });
    expect({ posts: posts(requests), asks }).toEqual({ posts: [], asks: [] });
  });

  it("starts a run when the plan has none, since there is no run to start a node on", async () => {
    const { deps, requests, asks } = scene(NO_RUN);

    await askFloorRefine(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
      refine: REFINE,
      actor: "ana",
    });

    expect({
      started: posts(requests).at(-1)?.path,
      recorded: asks.length,
    }).toEqual({
      started: "/assembly-lines/feature-planning/start",
      recorded: 1,
    });
  });

  it("starts the station in every state but an approved plan and an open analyze visit, on draft plan p1", async () => {
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

    expect(await refusalsOf(DRAFT, scenes)).toMatchObject({
      refusals: {
        noRun: "resumed",
        specWorkFailed: "resumed",
        cancelled: "resumed",
        delivered: "resumed",
        specPrOpen: "resumed",
        whileAnalyzing: "409: the planning agent is still working on this plan",
        settlingThePass: "resumed",
        writingSpecs: "resumed",
        decomposing: "resumed",
      },
    });
  });

  it("refuses an approved plan in every state, since approval settles its sections", async () => {
    const scenes = {
      noRun: NO_RUN,
      delivered: { runs: [FINISHED], visits: DELIVERED },
      specPrOpen: { visits: ON_MERGED },
      writingSpecs: { visits: WHILE_WRITING },
    };
    const { refusals } = await refusalsOf(APPROVED, scenes);

    expect(
      Object.values(refusals).every((refusal) => refusal.startsWith("409: ")),
    ).toBe(true);
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
        actor: "ana",
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

const PLAN_URL = "https://lore.example/repos/re-cinq/lore/plans/p1";
const CITABLE = {
  plan_url: PLAN_URL,
  blocks: [
    {
      id: "b-why",
      slot: "intent",
      kind: "paragraph",
      text: "Checkout is slow.",
      link: `${PLAN_URL}#b-why`,
    },
  ],
};

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

  it("hands the author visit the plan's citable blocks as plan_blocks beside plan.md", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });

    await approveFloorPlan(deps, {
      plan: APPROVED,
      planMarkdown: MARKDOWN,
      citablePlan: CITABLE,
      brief: BRIEF,
    });

    expect({
      blobs: posts(requests)
        .filter((request) => request.path === "/blobs")
        .map((request) => request.body),
      produced: reportedProduced(requests),
    }).toEqual({
      blobs: [MARKDOWN, JSON.stringify(CITABLE)],
      produced: {
        plan_md: PLAN_BLOB_HASH,
        plan_blocks: PLAN_BLOB_HASH,
        description: BRIEF,
      },
    });
  });

  it("starts the spec pass with plan_blocks when the floor holds no run", async () => {
    const { deps, requests } = scene(NO_RUN);

    await approveFloorPlan(deps, {
      plan: APPROVED,
      planMarkdown: MARKDOWN,
      citablePlan: CITABLE,
      brief: BRIEF,
    });

    expect(startedItem(requests, "plan_blocks")).toEqual({
      kind: "file",
      ref: PLAN_BLOB_HASH,
      by: "lore",
    });
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
    const { deps, asks } = scene({ visits: ON_AUTHOR });
    const verbs = floorPlanVerbs(deps, async () => ({
      planMarkdown: MARKDOWN,
    }));

    await verbs.refine(DRAFT, REFINE);

    expect(asks.at(0)?.brief).toContain("<!-- slot:intent -->");
  });

  it("lists the plan's unresolved finding in the brief a Refine gives the agent, and in a draft's", async () => {
    const snapshot = async () => ({
      planMarkdown: MARKDOWN,
      openFindings: [
        {
          findingId: "f-ground-9k2",
          slot: "scope",
          severity: "warning",
          text: "This section names `ToolResponse`.",
          why: "It is not on the default branch.",
        },
      ],
    });
    const refined = scene({ visits: ON_AUTHOR });
    const drafted = scene({ visits: ON_AUTHOR });

    await floorPlanVerbs(refined.deps, snapshot).refine(DRAFT, REFINE);
    await floorPlanVerbs(drafted.deps, snapshot).draft(DRAFT, {
      known: "checkout drops carts",
      createdBy: "gedaiu",
    });

    expect([
      refined.asks.at(0)?.brief,
      reportedProduced(drafted.requests).description,
    ]).toEqual([
      expect.stringContaining("- Finding f-ground-9k2 on `scope` (warning):"),
      expect.stringContaining("- Finding f-ground-9k2 on `scope` (warning):"),
    ]);
  });

  it("tells the agent what the plan's author already knows on a first draft", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });
    const verbs = floorPlanVerbs(deps, async () => ({
      planMarkdown: MARKDOWN,
    }));

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

  it("briefs the pass as an amendment to the specs on main when an earlier spec PR merged", async () => {
    const merged = [
      planVisit("open-spec-pr", {
        outcome: "success",
        produced: { pr_url: "https://github.com/re-cinq/lore/pull/7" },
      }),
      planVisit("merged", { outcome: "success" }),
    ];
    const { deps, requests } = scene({
      runs: [FINISHED],
      visits: merged,
      specPrState: "merged",
    });

    await startFloorSpecWork(deps, {
      plan: APPROVED,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(startedDescription(requests)).toContain("spec PR #7");
  });

  it("briefs the pass as amending the branch of a spec PR still open", async () => {
    const open = [
      planVisit("open-spec-pr", {
        outcome: "success",
        produced: { pr_url: "https://github.com/re-cinq/lore/pull/9" },
      }),
    ];
    const { deps, requests } = scene({
      runs: [FINISHED],
      visits: open,
      specPrState: "open",
    });

    await startFloorSpecWork(deps, {
      plan: APPROVED,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(startedDescription(requests)).toContain("Spec PR #9 is open");
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

  it("cancels the run while the specs are being written, and while the spec-tasks are being filed", async () => {
    const cancels = async (visits: VisitView[]) => {
      const { deps, requests } = scene({ visits });

      await reopenFloorPlan(deps, APPROVED);

      return posts(requests).map((request) => request.path);
    };

    expect([await cancels(WHILE_WRITING), await cancels(DECOMPOSING)]).toEqual([
      ["/assembly-runs/run-open/cancel"],
      ["/assembly-runs/run-open/cancel"],
    ]);
  });

  it("gives the floor the reopening as the reason it cancelled the run", async () => {
    const { deps, requests } = scene({ visits: WHILE_WRITING });

    await reopenFloorPlan(deps, APPROVED);

    expect(posts(requests).at(0)?.body).toEqual({
      reason: "the plan was reopened for writing",
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
    const verbs = floorPlanVerbs(deps, async (subject) => {
      reads.push(subject.id);

      return { planMarkdown: MARKDOWN };
    });

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

  it("hands an approval the snapshot's citable blocks as plan_blocks", async () => {
    const { deps, requests } = scene({ visits: ON_AUTHOR });
    const verbs = floorPlanVerbs(deps, async () => ({
      planMarkdown: MARKDOWN,
      citablePlan: CITABLE,
    }));

    await verbs.handOverApproved(APPROVED, "gedaiu");

    expect(reportedProduced(requests).plan_blocks).toBe(PLAN_BLOB_HASH);
  });

  it("reopens an approved plan whose run waits on its author and says it did", async () => {
    const { deps } = scene({ visits: ON_AUTHOR });
    const reopened: string[] = [];
    const verbs = floorPlanVerbs(deps, async () => ({
      planMarkdown: MARKDOWN,
    }));

    const locked = await verbs.openForAuthor(APPROVED, async (planId) =>
      reopened.push(planId),
    );

    expect(locked).toBe(true);
    expect(reopened).toEqual(["p1"]);
  });
});

function startedStoryIssue(requests: FloorRequest[]): string | undefined {
  const body = posts(requests).at(-1)?.body as {
    startItems?: { story_issue?: { ref?: string } };
  };

  return body?.startItems?.story_issue?.ref;
}

describe("the user story a planning run carries", () => {
  it("starts the run with story_issue 42 when the draft names issue 42", async () => {
    const { deps, requests } = scene(NO_RUN);

    await startFloorDrafting(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
      storyIssue: 42,
    });

    expect(startedStoryIssue(requests)).toBe("42");
  });

  it("carries story_issue 42 over from the finished run when a later round names no story", async () => {
    const storied = planRun({
      outcome: "failed",
      finishedAt: "2026-10-01T10:00:00.000Z",
      startItems: {
        ...FINISHED.startItems,
        story_issue: { kind: "value", ref: "42", by: "lore" },
      },
    });
    const { deps, requests } = scene({ runs: [storied] });

    await startFloorDrafting(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(startedStoryIssue(requests)).toBe("42");
  });

  it("starts the run with no story_issue when neither the draft nor an earlier run names a story", async () => {
    const { deps, requests } = scene({ runs: [FINISHED] });

    await startFloorDrafting(deps, {
      plan: DRAFT,
      planMarkdown: MARKDOWN,
      brief: BRIEF,
    });

    expect(startedStoryIssue(requests)).toBeUndefined();
  });
});
