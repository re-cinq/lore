import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FloorProblem } from "@re-cinq/floor-client";
import {
  fileOf,
  pipelineOf,
  readPipelineFile,
  writePipelineFile,
} from "@re-cinq/floor-pipeline";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  pipelineOfText,
  seedFloorPipelines,
  storedAgentSettings,
  withEnvironment,
  type SeedDeps,
} from "./seed-floor-pipelines.js";

const FIXED_ENV = {
  LORE_AGENT_IMAGE: "ghcr.io/re-cinq/agent:1",
  LORE_SKILLS_URL: "https://skills.example",
  LORE_MCP_URL: "https://mcp.example/mcp",
};

const PIPELINES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../libs/assembly-lines/src/floor-pipelines",
);

function realFiles() {
  return readdirSync(PIPELINES_DIR)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => ({
      name,
      text: readFileSync(path.join(PIPELINES_DIR, name), "utf-8"),
    }));
}

function fakeFloor(held: string[]) {
  const imported: string[] = [];
  const deps: SeedDeps = {
    files: async () => [
      { name: "a.yaml", text: "line:\n  id: code-review\n" },
      { name: "b.yaml", text: "line:\n  id: lore-run-settled\n" },
    ],
    env: {},
    agentSettings: async () => new Map(),
    heldAgentDefinitions: async () => [],
    importPipeline: async (pipeline) => {
      const id = pipeline.line?.id ?? "";

      imported.push(id);

      return [{ kind: "assembly-lines", id, changed: !held.includes(id) }];
    },
  };

  return { deps, imported };
}

interface StationBody {
  outcomes: string[];
}

interface LineBody {
  nodes: Array<{ id: string; station?: string }>;
  edges: Array<{
    from: string;
    to: string;
    on: string;
    iterationMax?: number;
  }>;
}

describe("withEnvironment", () => {
  it("fills ${LORE_MCP_URL} with the value given", () => {
    expect(withEnvironment("url: ${LORE_MCP_URL}", FIXED_ENV)).toEqual(
      "url: https://mcp.example/mcp",
    );
  });

  it("throws naming LORE_AGENT_IMAGE when it is unset", () => {
    expect(() => withEnvironment("image: ${LORE_AGENT_IMAGE}", {})).toThrow(
      new Error("LORE_AGENT_IMAGE is not set, and a pipeline names it"),
    );
  });
});

describe("seedFloorPipelines", () => {
  it("reads code-review's stored prompt, model, timeout, image and config from its org row", () => {
    const row = {
      name: "code-review",
      prompt: "Review.\n",
      model: "claude-sonnet-4-6",
      timeout_minutes: 25,
      image: null,
      execution_mode: "claude-code",
      review_required: true,
      config: null,
      project_id: null,
    };

    expect(Object.fromEntries(storedAgentSettings([row]))).toEqual({
      "code-review": {
        prompt: "Review.\n",
        model: "claude-sonnet-4-6",
        timeout_minutes: 25,
        image: null,
        config: null,
      },
    });
  });

  it("puts the stored code-review prompt and claude-sonnet-4-6 over the pipeline file's gemini-4-argon", async () => {
    const put: unknown[] = [];

    await seedFloorPipelines({
      files: async () => [
        {
          name: "code-review.yaml",
          text: "agent_definitions:\n  code-review:\n    settings:\n      model: gemini-4-argon\n",
        },
      ],
      env: {},
      agentSettings: async () =>
        new Map([
          [
            "code-review",
            { prompt: "Stored prompt.\n", model: "claude-sonnet-4-6" },
          ],
        ]),
      importPipeline: async (pipeline) => {
        put.push(...pipeline.agentDefinitions);

        return [];
      },
      heldAgentDefinitions: async () => [],
    });

    expect(put).toEqual([
      {
        id: "code-review",
        body: {
          settings: { model: "claude-sonnet-4-6", prompt: "Stored prompt.\n" },
        },
      },
    ]);
  });

  it("reports code-review's prompt as drifted when the floor still holds the old prompt after the put", async () => {
    const seeded = await seedFloorPipelines({
      files: async () => [
        {
          name: "code-review.yaml",
          text: "agent_definitions:\n  code-review:\n    settings: {}\n",
        },
      ],
      env: {},
      agentSettings: async () =>
        new Map([
          ["code-review", { prompt: "New.\n" }],
          ["no-pipeline-runs-me", { prompt: "Unused.\n" }],
        ]),
      importPipeline: async () => [],
      heldAgentDefinitions: async (ids) =>
        ids.map((id) => ({ id, body: { settings: { prompt: "Old.\n" } } })),
    });

    expect(seeded.drift).toEqual([{ name: "code-review", fields: ["prompt"] }]);
  });

  it("puts both pipelines and reports only lore-run-settled as changed when the floor holds code-review as written", async () => {
    const { deps, imported } = fakeFloor(["code-review"]);

    expect(await seedFloorPipelines(deps)).toEqual({
      drift: [],
      changed: ["assembly-lines/lore-run-settled"],
      failed: [],
    });
    expect(imported).toEqual(["code-review", "lore-run-settled"]);
  });

  it("reports both lines as changed on a floor that holds neither", async () => {
    const { deps } = fakeFloor([]);

    expect(await seedFloorPipelines(deps)).toEqual({
      drift: [],
      changed: [
        "assembly-lines/code-review",
        "assembly-lines/lore-run-settled",
      ],
      failed: [],
    });
  });

  it("reports nothing changed when the floor holds every pipeline as written", async () => {
    const { deps } = fakeFloor(["code-review", "lore-run-settled"]);

    expect(await seedFloorPipelines(deps)).toEqual({
      drift: [],
      changed: [],
      failed: [],
    });
  });

  it("puts b.yaml and reports a.yaml as failed when the floor refuses a.yaml", async () => {
    const { deps, imported } = fakeFloor([]);
    const put = deps.importPipeline;

    deps.importPipeline = (pipeline) =>
      pipeline.line?.id === "code-review"
        ? Promise.reject(new Error("invalid station body"))
        : put(pipeline);

    expect(await seedFloorPipelines(deps)).toEqual({
      drift: [],
      changed: ["assembly-lines/lore-run-settled"],
      failed: [{ name: "a.yaml", reason: "invalid station body" }],
    });
    expect(imported).toEqual(["lore-run-settled"]);
  });

  it("reports the floor's problem list with its title when the floor refuses a line body as invalid", async () => {
    const { deps } = fakeFloor([]);
    const refusal = new FloorProblem(
      {
        type: "about:blank",
        title: "invalid line body",
        status: 400,
        errors: [
          'node "plan-grounding" needs "target" (bound as "base") as kind "git", which nothing in the line seeds',
          'node "validate" needs "target" (bound as "base") as kind "git", which nothing in the line seeds',
        ],
      },
      { method: "POST", path: "/assembly-lines" },
    );

    deps.importPipeline = () => Promise.reject(refusal);

    expect(await seedFloorPipelines(deps)).toEqual({
      drift: [],
      changed: [],
      failed: [
        {
          name: "a.yaml",
          reason:
            'the floor refused POST /assembly-lines with 400: invalid line body: node "plan-grounding" needs "target" (bound as "base") as kind "git", which nothing in the line seeds; node "validate" needs "target" (bound as "base") as kind "git", which nothing in the line seeds',
        },
        {
          name: "b.yaml",
          reason:
            'the floor refused POST /assembly-lines with 400: invalid line body: node "plan-grounding" needs "target" (bound as "base") as kind "git", which nothing in the line seeds; node "validate" needs "target" (bound as "base") as kind "git", which nothing in the line seeds',
        },
      ],
    });
  });

  it("names a station two pipelines share once", async () => {
    const { deps } = fakeFloor([]);
    const shared = { kind: "stations", id: "post-review", changed: true };

    deps.importPipeline = () => Promise.resolve([shared]);

    expect(await seedFloorPipelines(deps)).toEqual({
      drift: [],
      changed: ["stations/post-review"],
      failed: [],
    });
  });
});

describe("the pipeline files shipped in libs/assembly-lines", () => {
  const pipelines = realFiles().map((file) =>
    pipelineOfText(file.text, FIXED_ENV),
  );
  const issueTriage = () =>
    pipelines.find((one) => one.line?.id === "issue-triage");
  const issueTriageLine = () =>
    issueTriage()?.line?.body as unknown as LineBody;
  const issueTriageOutcomes = () =>
    (
      issueTriage()?.stations.find((one) => one.id === "triage-verify")
        ?.body as unknown as StationBody
    ).outcomes;
  const edgeTarget = (line: LineBody, from: string, outcome: string) =>
    line.edges.find((edge) => edge.from === from && edge.on === outcome)?.to;

  it("declare the lines auto-merge, code-review, code-review-recheck, code-review-reply, daily-digest, feature-planning, implementation-loop, issue-triage, lore-run-settled, merge, onboard, spec-tickets, spec-upkeep and weekly-changelog", () => {
    expect(pipelines.map((pipeline) => pipeline.line?.id).sort()).toEqual([
      "auto-merge",
      "code-review",
      "code-review-recheck",
      "code-review-reply",
      "daily-digest",
      "feature-planning",
      "implementation-loop",
      "issue-triage",
      "lore-run-settled",
      "merge",
      "onboard",
      "spec-tickets",
      "spec-upkeep",
      "weekly-changelog",
    ]);
  });

  it("declares issue-triage human-gate as a kind: human station with route '{args.issue_url}'", () => {
    const issueTriage = pipelines.find((p) => p.line?.id === "issue-triage");
    const humanGate = issueTriage?.stations.find((s) => s.id === "human-gate");

    expect(humanGate?.body.kind).toBe("human");
    expect(humanGate?.body.route).toBe("{args.issue_url}");
  });

  it("routes issue-triage human-gate's success edge to done", () => {
    const issueTriage = pipelines.find((p) => p.line?.id === "issue-triage");

    type LineBody = {
      edges: Array<{ from: string; to: string; on: string }>;
    };
    const body = issueTriage?.line?.body as LineBody | undefined;
    const successEdge = body?.edges.find(
      (e) => e.from === "human-gate" && e.on === "success",
    );

    expect(successEdge?.to).toBe("done");
  });

  it("routes every outcome triage-verify declares to a node issue-triage declares", () => {
    const line = issueTriageLine();
    const nodes = new Set(line.nodes.map((node) => node.id));
    const routed = issueTriageOutcomes().map((outcome) => ({
      outcome,
      to: edgeTarget(line, "verify", outcome),
    }));

    expect(routed).toEqual([
      { outcome: "success", to: "human-gate" },
      { outcome: "obsolete", to: "close-obsolete" },
      { outcome: "not-actionable", to: "label-not-actionable" },
      { outcome: "large-issue", to: "decompose" },
      { outcome: "failed", to: "label-failed" },
    ]);
    expect(routed.filter(({ to }) => !nodes.has(to ?? ""))).toEqual([]);
  });

  it("routes a large issue through decompose and triage-file-issues to done", () => {
    const line = issueTriageLine();

    expect({
      decompose: line.nodes.find(({ id }) => id === "decompose")?.station,
      fileIssues: line.nodes.find(({ id }) => id === "file-issues")?.station,
      decomposed: edgeTarget(line, "decompose", "success"),
      filed: edgeTarget(line, "file-issues", "success"),
      reworked: edgeTarget(line, "file-issues", "changes_requested"),
    }).toEqual({
      decompose: "triage-decompose",
      fileIssues: "triage-file-issues",
      decomposed: "file-issues",
      filed: "done",
      reworked: "decompose",
    });
  });

  it("declares each station name with one body across every pipeline file, since the floor keeps the last one put", () => {
    const bodies = new Map<string, Set<string>>();

    for (const { id, body } of pipelines.flatMap((one) => one.stations)) {
      bodies.set(id, (bodies.get(id) ?? new Set()).add(JSON.stringify(body)));
    }

    expect(
      [...bodies].filter(([, declared]) => declared.size > 1).map(([id]) => id),
    ).toEqual([]);
  });

  it("starts issue-triage with implementation reconciliation before reproduction", () => {
    expect(issueTriage()?.line?.body).toMatchObject({
      entry: "load-implementation",
    });
    expect(
      [
        "implemented",
        "partial",
        "missing",
        "unproven",
        "needs-person",
        "changes_requested",
        "failed",
      ].map((outcome) =>
        edgeTarget(issueTriageLine(), "verify-implementation", outcome),
      ),
    ).toEqual([
      "close-obsolete",
      "reproduce",
      "reproduce",
      "reproduce",
      "human-gate",
      "assess-implementation",
      "label-failed",
    ]);
  });

  it("routes every reproduce outcome through its matching label node", () => {
    const line = issueTriageLine();
    const reproduce = issueTriage()?.stations.find(
      (station) => station.id === "triage-reproduce",
    )?.body as unknown as StationBody;
    const routed = reproduce.outcomes.map((outcome) => ({
      outcome,
      to: edgeTarget(line, "reproduce", outcome),
    }));
    const failed = line.edges.find(
      (edge) => edge.from === "reproduce" && edge.on === "failed",
    );

    expect(routed).toEqual([
      { outcome: "success", to: "label-reproduced" },
      { outcome: "unable-to-reproduce", to: "label-unable" },
      { outcome: "needs-reproduction", to: "label-needs-repro" },
      { outcome: "skipped", to: "label-skipped" },
      { outcome: "failed", to: "label-failed" },
    ]);
    const nodeIds = new Set(line.nodes.map(({ id }) => id));

    expect(routed.filter(({ to }) => !nodeIds.has(to ?? ""))).toEqual([]);
    expect(failed).toMatchObject({ iterationMax: 3, to: "label-failed" });
  });

  it("routes diagnose success through label-diagnosed to verify and retries failures three times", () => {
    const line = issueTriageLine();
    const diagnoseSuccess = edgeTarget(line, "diagnose", "success");
    const labelDiagnosed = edgeTarget(line, "label-diagnosed", "success");
    const diagnoseFailure = line.edges.find(
      (edge) => edge.from === "diagnose" && edge.on === "failed",
    );

    expect({ diagnoseSuccess, labelDiagnosed, diagnoseFailure }).toEqual({
      diagnoseSuccess: "label-diagnosed",
      labelDiagnosed: "verify",
      diagnoseFailure: {
        from: "diagnose",
        to: "label-failed",
        on: "failed",
        iterationMax: 3,
      },
    });
  });

  it("routes verified closure to done and unproven closure to human review", () => {
    const line = issueTriageLine();
    const node = line.nodes.find(
      (pipelineNode) => pipelineNode.id === "close-obsolete",
    );
    const service = issueTriage()?.stations.find(
      (station) => station.id === "close-issue",
    );
    const outgoing = line.edges.filter(
      (edge) => edge.from === "close-obsolete",
    );

    expect({
      station: node?.station,
      kind: service?.body.kind,
      outgoing,
    }).toEqual({
      station: "close-issue",
      kind: "service",
      outgoing: [
        { from: "close-obsolete", to: "done", on: "success" },
        { from: "close-obsolete", to: "human-gate", on: "unproven" },
        { from: "close-obsolete", to: "label-failed", on: "failed" },
      ],
    });
  });

  it("give every agent definition a non-empty prompt", () => {
    const prompts = pipelines
      .flatMap((pipeline) => pipeline.agentDefinitions)
      .map(
        (definition) => (definition.body.settings as { prompt: string }).prompt,
      );

    expect(prompts.every((prompt) => prompt.length > 0)).toBe(true);
  });

  it("put feature-planning exactly as a file carrying the same prompts inline would, trailing newline included", () => {
    const featurePlanning = pipelines.find(
      (pipeline) => pipeline.line?.id === "feature-planning",
    );

    enforceTrue(featurePlanning, Error, "no feature-planning pipeline");
    const inline = pipelineOf(
      readPipelineFile(writePipelineFile(fileOf(featurePlanning))),
    );

    expect(featurePlanning).toEqual(inline);
  });
});

describe("the agent stations a shipped pipeline is put with", () => {
  it("carry resultRequired for loop-dod and loop-fix-ci, so the floor fails an agent that ends without a result line", () => {
    const loop = pipelineOfText(
      realFiles().find((file) => file.name === "implementation-loop.yaml")
        ?.text ?? "",
      FIXED_ENV,
    );

    expect(
      ["loop-dod", "loop-fix-ci"].map(
        (name) =>
          (
            loop.stations.find((station) => station.id === name)?.body as
              { resultRequired?: boolean } | undefined
          )?.resultRequired,
      ),
    ).toEqual([true, true]);
  });
});
