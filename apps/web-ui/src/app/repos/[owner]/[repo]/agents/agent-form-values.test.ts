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
});
