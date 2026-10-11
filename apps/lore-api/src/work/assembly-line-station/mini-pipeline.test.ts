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

  describe("a node several pods ran at once", () => {
    const nodes = [{ id: "write", type: "agent" }];
    const pods = (...outcomes: (string | null)[]) =>
      outcomes.map((outcome) => ({ nodeId: "write", iteration: 1, outcome }));

    it("is running while any of its pods is still open", () => {
      expect(miniPipeline(nodes, pods("success", null, "success"))).toEqual([
        { node_id: "write", state: "running" },
      ]);
    });

    it("is failed once all have reported and one failed", () => {
      expect(miniPipeline(nodes, pods("success", "failed", "success"))).toEqual(
        [{ node_id: "write", state: "failed" }],
      );
    });

    it("is success when every pod succeeded", () => {
      expect(miniPipeline(nodes, pods("success", "success"))).toEqual([
        { node_id: "write", state: "success" },
      ]);
    });

    it("reads only the latest iteration, so a redo does not inherit the first round's failure", () => {
      const visits = [
        ...pods("failed", "success"),
        { nodeId: "write", iteration: 2, outcome: "success" },
      ];

      expect(miniPipeline(nodes, visits)).toEqual([
        { node_id: "write", state: "success" },
      ]);
    });
  });
});
