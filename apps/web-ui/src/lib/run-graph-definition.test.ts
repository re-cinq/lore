import { describe, it, expect } from "vitest";
import { definitionForRun } from "./run-graph-definition";
import {
  codeReviewDefinition,
  implementationDefinition,
} from "./builtin-definitions";
import type { AssemblyLineRunNode } from "./assembly-line-runs";

const row = (
  nodeId: string,
  over: Partial<AssemblyLineRunNode> = {},
): AssemblyLineRunNode => ({
  nodeId,
  iteration: 1,
  outcome: "success",
  agentCrName: null,
  commitSha: null,
  durationSeconds: null,
  ...over,
});

describe("definitionForRun", () => {
  it("returns the implementation builtin for definition name implementation", () => {
    expect(definitionForRun("implementation", [])).toEqual({
      definition: implementationDefinition,
      synthetic: false,
    });
  });

  it("returns the code-review builtin for definition name code-review", () => {
    expect(definitionForRun("code-review", [])).toEqual({
      definition: codeReviewDefinition,
      synthetic: false,
    });
  });

  it("returns synthetic true for an unknown definition name with visit rows", () => {
    expect(definitionForRun("bespoke", [row("draft")])).toMatchObject({
      synthetic: true,
      definition: { name: "bespoke", entry: "draft", exit: "draft" },
    });
  });

  it("returns distinct node ids in visit order for repeated rows of the same node", () => {
    const { definition } = definitionForRun("bespoke", [
      row("draft"),
      row("validate"),
      row("draft", { iteration: 2 }),
      row("push"),
    ]);

    expect(definition?.nodes).toEqual([
      { id: "draft", type: "agent" },
      { id: "validate", type: "agent" },
      { id: "push", type: "agent" },
    ]);
  });

  it("joins synthesized nodes with sequential always edges", () => {
    const { definition } = definitionForRun("bespoke", [
      row("draft"),
      row("validate"),
      row("push"),
    ]);

    expect(definition?.edges).toEqual([
      { from: "draft", to: "validate", on: "always" },
      { from: "validate", to: "push", on: "always" },
    ]);
  });

  it("returns a null definition for an unknown name with zero visit rows", () => {
    expect(definitionForRun("bespoke", [])).toEqual({
      definition: null,
      synthetic: true,
    });
  });
});
