import { describe, it, expect } from "vitest";
import type { AgentDefinition } from "@/lib/agents-mirror";
import { groupAgentsByLine, UNUSED_LINE } from "./group-by-line";

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
