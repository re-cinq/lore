import { describe, it, expect } from "vitest";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import {
  nodeAgentName,
  nodeAgentSpec,
  nodeStationSpec,
  stationNodeParams,
  stationRunInputFor,
  type FloorAssemblyRunTask,
} from "./floor-assembly-run.js";

const task: FloorAssemblyRunTask = {
  taskId: "abcdef1234567890",
  pipelineTaskId: "abcdef1234567890",
  assemblyLineId: "a1b2c3d4e5f6a7b8",
  taskType: "implementation",
  description: "Implement the spec",
  targetRepo: "re-cinq/lore",
  branch: "lore/impl-abcdef12",
};

/** A clone node. `station` / `station_inherited` are what `snapshotGraph` resolves;
 *  defaulted here so a test about names, labels or outcomes need not restate them. */
function cloneNode(
  over: Partial<RunGraphNode> & { id: string; type: string },
): RunGraphNode {
  return { station: null, station_inherited: false, ...over };
}

describe("nodeAgentSpec", () => {
  it("builds a per-node spec: distinct name, node prompt + model, task repo/branch", () => {
    const node = cloneNode({
      id: "implement",
      type: "agent",
      model: "claude-sonnet-4-6",
    });

    expect(nodeAgentSpec(node, task, "do it")).toEqual({
      taskId: "abcdef1234567890",
      taskType: "implementation",
      description: "Implement the spec",
      prompt: "do it",
      targetRepo: "re-cinq/lore",
      branch: "lore/impl-abcdef12",
      model: "claude-sonnet-4-6",
      name: "a1b2c3d4e5f6-implement",
      extraLabels: {
        "lore.re-cinq.com/assembly-run-id": "a1b2c3d4e5f6a7b8",
        "lore.re-cinq.com/node-id": "implement",
        "lore.re-cinq.com/node-iteration": "1",
      },
    });
    expect(nodeAgentName(task.assemblyLineId, "review")).toBe(
      "a1b2c3d4e5f6-review",
    );
  });

  it("omits model when the node inherits it", () => {
    expect(
      nodeAgentSpec(cloneNode({ id: "push", type: "agent" }), task, "p"),
    ).not.toHaveProperty("model");
  });

  it("suffixes the CR name + labels with the iteration for a revisited node", () => {
    // Iteration 1 keeps the bare name (back-compat); a revisit (iteration>1) gets a
    // distinct name + label so it runs a fresh pod, not a 409-reuse of the prior CR.
    expect(nodeAgentName(task.assemblyLineId, "review", 2)).toBe(
      "a1b2c3d4e5f6-review-2",
    );
    const spec = nodeAgentSpec(
      cloneNode({ id: "review", type: "agent" }),
      task,
      "p",
      2,
    );

    expect(spec.name).toBe("a1b2c3d4e5f6-review-2");
    expect(spec.extraLabels?.["lore.re-cinq.com/node-iteration"]).toBe("2");
  });

  it("labels the CR with the full assembly-run id, node id and iteration (event-driven transitions)", () => {
    // The CR name only carries a 12-char prefix; the labels carry the full uuid so
    // the k8s watch can map a terminal node CR back to its (line, node, iteration).
    expect(
      nodeAgentSpec(cloneNode({ id: "implement", type: "agent" }), task, "p")
        .extraLabels,
    ).toEqual({
      "lore.re-cinq.com/assembly-run-id": "a1b2c3d4e5f6a7b8",
      "lore.re-cinq.com/node-id": "implement",
      "lore.re-cinq.com/node-iteration": "1",
    });
    expect(
      nodeStationSpec(cloneNode({ id: "wrap", type: "retrospective" }), task)
        .extraLabels,
    ).toEqual({
      "lore.re-cinq.com/assembly-run-id": "a1b2c3d4e5f6a7b8",
      "lore.re-cinq.com/node-id": "wrap",
      "lore.re-cinq.com/node-iteration": "1",
    });
  });
});

describe("nodeAgentSpec station_ref", () => {
  it("threads the node's station_ref so a renamed recipe still resolves (code-review-reply -> code-review-refine)", () => {
    expect(
      nodeAgentSpec(
        cloneNode({
          id: "reply",
          type: "agent",
          prompt_ref: "code-review-refine",
          station: "code-review-refine",
        }),
        task,
        "prompt",
      ).stationRef,
    ).toBe("code-review-refine");
    expect(
      nodeAgentSpec(cloneNode({ id: "reply", type: "agent" }), task, "prompt")
        .stationRef,
    ).toBeUndefined();
  });
});

describe("nodeStationSpec (station pod contract)", () => {
  it("builds the station_input payload the pod parses, defaulting stationRef to def-<type>", () => {
    const spec = nodeStationSpec(
      cloneNode({ id: "validate", type: "validate" }),
      task,
    );

    // The recipe's prompt template is literally {station_input} — the whole node
    // input rides this one JSON parameter that every lore-station pod parses.
    expect(spec.stationRef).toBe("def-validate");
    expect(JSON.parse(spec.parameters!.station_input)).toEqual({
      assembly_run_id: "a1b2c3d4e5f6a7b8",
      assembly_line_id: "a1b2c3d4e5f6a7b8",
      node_id: "validate",
      node_type: "validate",
      repo: "re-cinq/lore",
      branch: "lore/impl-abcdef12",
      task_id: "abcdef1234567890",
      params: {},
    });
  });

  it("threads string + number line args into params, skipping non-primitive values", () => {
    const spec = nodeStationSpec(
      cloneNode({ id: "triage", type: "comment-triage" }),
      {
        ...task,
        args: {
          comment_body: "ok, fix it",
          in_reply_to_id: 5,
          nested: { skip: true },
          description: "prose",
        },
      },
    );

    expect(JSON.parse(spec.parameters!.station_input).params).toEqual({
      comment_body: "ok, fix it",
      in_reply_to_id: "5",
      description: "prose",
    });
  });

  it("honors an explicit station_ref override (custom station image)", () => {
    expect(
      nodeStationSpec(
        cloneNode({
          id: "detect",
          type: "detect",
          station: "def-custom-detect",
        }),
        task,
      ).stationRef,
    ).toBe("def-custom-detect");
  });

  it("marks only ingest and validate nodes for cloning — detect/gate/retrospective/triage read via the API and a checkout of their synthetic lease-key branch would fail the init", () => {
    const cloneByType = (type: string) =>
      nodeStationSpec(cloneNode({ id: type, type }), task).clone;

    expect(cloneByType("ingest")).toBe(true);
    expect(cloneByType("validate")).toBe(true);
    expect(cloneByType("detect")).toBe(false);
    expect(cloneByType("gate")).toBe(false);
    expect(cloneByType("retrospective")).toBe(false);
    expect(cloneByType("comment-triage")).toBe(false);
    expect(cloneByType("github_action")).toBe(false);
    expect(
      nodeAgentSpec(cloneNode({ id: "implement", type: "agent" }), task, "p")
        .clone,
    ).toBeUndefined();
  });

  it("clones at args.ref when set — the line's branch is only the lease key (ingest/<kind>/<ref>)", () => {
    const ingestTask = {
      ...task,
      branch: "ingest/specs/abc123",
      args: { kind: "specs", ref: "abc123" },
    };
    const spec = nodeStationSpec(
      cloneNode({ id: "ingest", type: "ingest" }),
      ingestTask,
    );

    expect(spec.branch).toBe("abc123");
    expect(JSON.parse(spec.parameters!.station_input).branch).toBe("abc123");
    expect(
      nodeAgentSpec(
        cloneNode({ id: "implement", type: "agent" }),
        ingestTask,
        "p",
      ).branch,
    ).toBe("abc123");
  });
});

describe("station-run id label", () => {
  it("stamps the visit's station-run id on both spec shapes when passed", () => {
    const agent = nodeAgentSpec(
      cloneNode({ id: "implement", type: "agent" }),
      task,
      "p",
      1,
      "3f6c1c9a-run",
    );
    const station = nodeStationSpec(
      cloneNode({ id: "wrap", type: "retrospective" }),
      task,
      1,
      "3f6c1c9a-run",
    );

    expect(agent.extraLabels?.["lore.re-cinq.com/station-run-id"]).toBe(
      "3f6c1c9a-run",
    );
    expect(station.extraLabels?.["lore.re-cinq.com/station-run-id"]).toBe(
      "3f6c1c9a-run",
    );
  });

  it("omits the label when no station-run id is passed", () => {
    expect(
      nodeAgentSpec(cloneNode({ id: "implement", type: "agent" }), task, "p")
        .extraLabels,
    ).not.toHaveProperty("lore.re-cinq.com/station-run-id");
  });
});

describe("what a visit was GIVEN, recorded at dispatch", () => {
  const agentNode = (over: Partial<RunGraphNode> & { id: string }) =>
    ({
      type: "agent",
      station: null,
      station_inherited: false,
      ...over,
    }) as RunGraphNode;
  const stationNode = (over: Partial<RunGraphNode> & { id: string }) =>
    ({
      type: "detect",
      station: null,
      station_inherited: false,
      ...over,
    }) as RunGraphNode;

  const task = {
    taskId: "t1",
    pipelineTaskId: "t1",
    assemblyLineId: "al-1",
    taskType: "implementation",
    description: "raw",
    targetRepo: "o/r",
    branch: "lore/impl-1",
    args: { comment_body: "please fix" },
  };

  it("builds an agent node's input with the resolved prompt and a null params map", () => {
    expect(
      stationRunInputFor(
        agentNode({ id: "review", prompt_ref: "code-review" }),
        task,
        "the round content",
        "the rendered prompt",
      ),
    ).toEqual({
      description: "the round content",
      prompt: "the rendered prompt",
      params: null,
      repo: "o/r",
      ref: "lore/impl-1",
    });
  });

  it("builds a station node's input from the same params the pod receives, without a prompt", () => {
    const node = stationNode({ id: "detect", job_ref: "spec_drift" });
    const input = stationRunInputFor(node, task, "d", null);

    expect(input.prompt).toBeNull();
    expect(input.params).toEqual(stationNodeParams(node, task));
    expect(input.params).toMatchObject({
      comment_body: "please fix",
      job_ref: "spec_drift",
    });
  });

  it("caps a long description and prompt with the storage truncation marker", () => {
    const input = stationRunInputFor(
      agentNode({ id: "review", prompt_ref: "code-review" }),
      task,
      "d".repeat(5_000),
      "p".repeat(20_000),
    );

    expect(input.description).toContain("[truncated, 5000 bytes]");
    expect(input.prompt).toContain("[truncated, 20000 bytes]");
  });
});
