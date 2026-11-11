import { describe, expect, it } from "vitest";
import { shippedAgentPrompts } from "@re-cinq/lore-shared/project/agents/pipeline-agents.js";
import { pipelineProblems } from "./pipeline-lint.js";

const prompts = shippedAgentPrompts();

describe("pipelineProblems — FR-15 continuation/retry behavior", () => {
  it("reports unbounded-retry for a back-edge to the same node without iteration_max (spec: specs/7-feature-planning/spec.md#L245)", () => {
    const yamlText = `
line:
  id: sound
  entry: work
  exit: done
  args:
    issue_url:
      kind: value
      subject: true
  nodes:
    - id: work
      station: work
    - id: done
  edges:
    - from: work
      to: work
      on: failed
    - from: work
      to: done
      on: success
stations:
  work:
    kind: service
    outcomes:
      - success
      - failed
    needs: []
    produces: []
`;

    const problems = pipelineProblems(yamlText, prompts);
    const unbounded = problems.find((p) => p.rule === "unbounded-retry");

    expect(unbounded).toMatchObject({
      line: "sound",
      node: "work",
      rule: "unbounded-retry",
      detail: expect.stringContaining("iteration_max"),
    });
  });

  it("reports unresolvable-conversation-key for a station whose conversation_key is not a declared arg (spec: specs/7-feature-planning/spec.md#L244)", () => {
    const yamlText = `
line:
  id: sound
  entry: work
  exit: done
  args:
    issue_url:
      kind: value
      subject: true
  nodes:
    - id: work
      station: work
    - id: done
  edges:
    - from: work
      to: done
      on: success
stations:
  work:
    kind: agent
    agent_definition: loop-dod
    conversation: continue
    conversation_key: unknown_arg
    outcomes:
      - success
    needs: []
    produces: []
`;

    const problems = pipelineProblems(yamlText, prompts);
    const unresolvable = problems.find(
      (p) => p.rule === "unresolvable-conversation-key",
    );

    expect(unresolvable).toMatchObject({
      line: "sound",
      rule: "unresolvable-conversation-key",
      detail: expect.stringContaining("unknown_arg"),
    });
  });
});
