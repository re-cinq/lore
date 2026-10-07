import { describe, it, expect } from "vitest";
import { miniPipeline } from "./mini-pipeline.js";

describe("miniPipeline", () => {
  it("colours each node by its latest visit: success, running for an open agent visit, waiting for an open ci_check, pending when unvisited", () => {
    const nodes = [
      { id: "dod", type: "agent" },
      { id: "tdd-round", type: "agent" },
      { id: "await-ci", type: "ci_check" },
      { id: "done", type: "retrospective" },
    ];
    const visits = [
      { nodeId: "dod", iteration: 1, outcome: "success" },
      { nodeId: "tdd-round", iteration: 1, outcome: "changes_requested" },
      { nodeId: "tdd-round", iteration: 2, outcome: null },
      { nodeId: "await-ci", iteration: 1, outcome: null },
    ];

    expect(miniPipeline(nodes, visits)).toEqual([
      { node_id: "dod", state: "success" },
      { node_id: "tdd-round", state: "running" },
      { node_id: "await-ci", state: "waiting" },
      { node_id: "done", state: "pending" },
    ]);
  });
});
