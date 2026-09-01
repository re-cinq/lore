import { describe, it, expect } from "vitest";
import { AgentDefs } from "./agent-defs.js";
import type {
  AgentDefinition,
  AgentDefinitionInput,
  AgentDefsPort,
} from "./agent-defs-port.js";

/**
 * project.agentDefs — the Agent *definition* methods, which delegate to the
 * AgentDefsPort bound to the facade's repo. Execution (run, trust-gated) is on
 * project.agents / Agents — see agents.test.ts.
 */

function recordingDefs(
  calls: Array<{ method: string; args: unknown[] }> = [],
): AgentDefsPort {
  const def: AgentDefinition = {
    name: "general",
    model: "claude-sonnet-4-6",
    timeout_minutes: 30,
    prompt: "Task: {description}",
    image: null,
    execution_mode: "claude-code",
    review_required: true,
    config: null,
    project_id: null,
  };

  return {
    resolve: async (repo, name) => (
      calls.push({ method: "resolve", args: [repo, name] }),
      def
    ),
    list: async (repo) => (calls.push({ method: "list", args: [repo] }), [def]),
    create: async (repo, d: AgentDefinitionInput) => (
      calls.push({ method: "create", args: [repo, d] }),
      { ...def, ...d, project_id: "p" }
    ),
    update: async (repo, name, patch) => (
      calls.push({ method: "update", args: [repo, name, patch] }),
      def
    ),
    delete: async (repo, name) =>
      void calls.push({ method: "delete", args: [repo, name] }),
  };
}

describe("AgentDefs", () => {
  it("resolves a definition bound to the facade's repo", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const agentDefs = new AgentDefs("re-cinq/re-plan", recordingDefs(calls));

    expect((await agentDefs.resolve("general"))?.name).toBe("general");
    expect(calls).toContainEqual({
      method: "resolve",
      args: ["re-cinq/re-plan", "general"],
    });
  });

  it("lists definitions for the repo", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const agentDefs = new AgentDefs("re-cinq/re-plan", recordingDefs(calls));

    expect((await agentDefs.list()).map((a) => a.name)).toEqual(["general"]);
    expect(calls).toContainEqual({ method: "list", args: ["re-cinq/re-plan"] });
  });

  it("delegates create/delete to the defs port with the bound repo", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const agentDefs = new AgentDefs("re-cinq/re-plan", recordingDefs(calls));

    await agentDefs.create({
      name: "custom",
      model: "claude-opus-4-8",
      timeout_minutes: 45,
      prompt: "do {description}",
      image: null,
      execution_mode: "claude-code",
      review_required: true,
      config: null,
    });
    await agentDefs.delete("custom");

    expect(calls.map((c) => c.method)).toEqual(["create", "delete"]);
    expect(calls[1].args).toEqual(["re-cinq/re-plan", "custom"]);
  });
});
