import { describe, it, expect } from "vitest";
import type { AgentDefinition } from "@/lib/agents-mirror";
import {
  agentTitles,
  groupAgentsByLine,
  lineTitle,
  UNUSED_LINE,
} from "./group-by-line";

const agentNamed = (name: string): AgentDefinition => ({
  name,
  model: null,
  timeout_minutes: null,
  prompt: "p",
  image: null,
  execution_mode: "claude-code",
  review_required: false,
  config: null,
  project_id: null,
});
const ref = (blueprint: string) => ({
  blueprint,
  node_id: "n",
  inherited: true,
});

describe("groupAgentsByLine", () => {
  it("returns code-review then implementation-loop then the unused group when agents span two lines", () => {
    const groups = groupAgentsByLine(
      [
        agentNamed("loop-dod"),
        agentNamed("orphan"),
        agentNamed("code-review"),
        agentNamed("loop-sync"),
      ],
      {
        refs: {
          "loop-dod": [ref("implementation-loop")],
          "loop-sync": [ref("implementation-loop")],
          "code-review": [ref("code-review")],
        },
      },
    );

    expect(
      groups.map(({ line, agents }) => [line, agents.map((a) => a.name)]),
    ).toEqual([
      ["code-review", ["code-review"]],
      ["implementation-loop", ["loop-dod", "loop-sync"]],
      [UNUSED_LINE, ["orphan"]],
    ]);
  });

  it("returns one group holding every agent when usage is unknown", () => {
    const agents = [agentNamed("a"), agentNamed("b")];

    expect(groupAgentsByLine(agents, null)).toEqual([
      { line: UNUSED_LINE, agents },
    ]);
  });
});

describe("lineTitle", () => {
  it("returns Code review, Feature planning and Code review recheck for their line ids", () => {
    expect(
      ["code-review", "feature-planning", "code-review-recheck"].map(lineTitle),
    ).toEqual(["Code review", "Feature planning", "Code review recheck"]);
  });
});

describe("agentTitles", () => {
  it("returns Verify and Diagnose for triage-verify and triage-diagnose", () => {
    expect(agentTitles(["triage-verify", "triage-diagnose"])).toEqual([
      "Verify",
      "Diagnose",
    ]);
  });

  it("returns Fix ci and Update specs for spec-upkeep-fix-ci and spec-upkeep-update-specs", () => {
    expect(
      agentTitles(["spec-upkeep-fix-ci", "spec-upkeep-update-specs"]),
    ).toEqual(["Fix ci", "Update specs"]);
  });

  it("returns Plan analyze and Spec draft when plan-analyze and spec-draft share no prefix", () => {
    expect(agentTitles(["plan-analyze", "spec-draft"])).toEqual([
      "Plan analyze",
      "Spec draft",
    ]);
  });

  it("returns Code review refine for a lone code-review-refine", () => {
    expect(agentTitles(["code-review-refine"])).toEqual(["Code review refine"]);
  });
});
