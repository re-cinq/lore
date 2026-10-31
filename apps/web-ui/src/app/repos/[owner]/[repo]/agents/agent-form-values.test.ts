import { describe, it, expect } from "vitest";
import { agentFormValues } from "./agent-form-values";
import type { AgentDefinition } from "@/lib/agents-mirror";

describe("agentFormValues", () => {
  it("returns empty prompt and promptInherited true when prompt is in inherited_fields", () => {
    const agent = {
      name: "code-review",
      model: "claude-sonnet-4-6",
      timeout_minutes: 30,
      prompt: "org prompt",
      image: null,
      execution_mode: "claude-code",
      review_required: true,
      config: null,
      project_id: "project-1",
      inherited_fields: ["prompt"],
    } satisfies AgentDefinition & { inherited_fields?: string[] };

    const values = agentFormValues(agent, { isNew: false });

    expect(values.prompt).toBe("");
    expect(values.promptInherited).toBe(true);
    expect(values.promptPlaceholder).toBe("org prompt");
  });

  it("fills the editor with the org prompt 'Make the test pass.' on the organisation default's own page", () => {
    const agent = {
      name: "loop-tdd",
      model: "claude-opus-4-7",
      timeout_minutes: 60,
      prompt: "Make the test pass.",
      image: null,
      execution_mode: "claude-code",
      review_required: false,
      config: null,
      project_id: null,
    } satisfies AgentDefinition;

    const values = agentFormValues(agent, { isNew: false, orgScope: true });

    expect({
      prompt: values.prompt,
      promptInherited: values.promptInherited,
    }).toEqual({
      prompt: "Make the test pass.",
      promptInherited: false,
    });
  });
});
