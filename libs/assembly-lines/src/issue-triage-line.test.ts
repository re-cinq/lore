import { describe, it, expect } from "vitest";
import { getNextTransition } from "./transition.js";
import { loadAssemblyLineFile } from "./loader.js";
import * as path from "node:path";

describe("issue-triage assembly line", () => {
  it("routes verify (obsolete) to close-obsolete [validated by specs/issue-triage/spec.md#User Story 3 - Obsolete Issue Detection and Automatic Closing (Priority: P2)]", async () => {
    const yamlPath = path.join(
      __dirname,
      "assembly-lines",
      "issue-triage.yaml",
    );
    const line = await loadAssemblyLineFile(yamlPath);

    const transition = getNextTransition(line, [
      { nodeId: "reproduce", iteration: 1, outcome: "success" },
      { nodeId: "verify", iteration: 1, outcome: "obsolete" },
    ]);

    expect(transition).toEqual({
      kind: "launch",
      nodeId: "close-obsolete",
      iteration: 1,
    });
  });
});
