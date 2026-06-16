import { describe, it, expect } from "vitest";
import { Agents } from "./agents.js";
import type { AgentRunnerPort } from "./agent-runner-port.js";
import type { AgentDefinition, AgentDefinitionInput, AgentDefsPort } from "./agent-defs-port.js";

/**
 * project.agents — the run() trust gate (only LOCAL execution is refused on the
 * shared server) plus the definition methods, which simply delegate to the
 * AgentDefsPort bound to the facade's repo.
 */

function fakeRunner(): AgentRunnerPort {
  return {
    run: async (repo, taskId, opts) => ({ taskId, mode: opts?.mode ?? "local", started: true }),
  };
}

function recordingDefs(calls: Array<{ method: string; args: unknown[] }> = []): AgentDefsPort {
  const def: AgentDefinition = {
    name: "general",
    model: "claude-sonnet-4-6",
    timeout_minutes: 30,
    prompt: "Task: {description}",
    image: null,
    execution_mode: "claude-code",
    review_required: true,
    project_id: null,
  };
  return {
    resolve: async (repo, name) => (calls.push({ method: "resolve", args: [repo, name] }), def),
    list: async (repo) => (calls.push({ method: "list", args: [repo] }), [def]),
    create: async (repo, d: AgentDefinitionInput) => (calls.push({ method: "create", args: [repo, d] }), { ...def, ...d, project_id: "p" }),
    update: async (repo, name, patch) => (calls.push({ method: "update", args: [repo, name, patch] }), def),
    delete: async (repo, name) => void calls.push({ method: "delete", args: [repo, name] }),
  };
}

describe("Agents trust gate", () => {
  it("refuses LOCAL execution on the shared server (LORE_DB_HOST set)", async () => {
    const agents = new Agents("re-cinq/lore", fakeRunner(), recordingDefs(), { LORE_DB_HOST: "lore-db.internal" });

    await expect(agents.run("task-1")).rejects.toThrow(
      new Error("Test commands run only in a trusted sandbox — run in CI or locally."),
    );
  });

  it("allows cluster mode even with LORE_DB_HOST set (the agent creates CRs on the cluster)", async () => {
    const agents = new Agents("re-cinq/lore", fakeRunner(), recordingDefs(), { LORE_DB_HOST: "lore-db.internal" });

    expect(await agents.run("task-2", { mode: "cluster" })).toEqual({
      taskId: "task-2",
      mode: "cluster",
      started: true,
    });
  });
});

describe("Agents definitions", () => {
  it("resolves a definition bound to the facade's repo", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const agents = new Agents("re-cinq/re-plan", fakeRunner(), recordingDefs(calls), {});

    expect((await agents.resolve("general"))?.name).toBe("general");
    expect(calls).toContainEqual({ method: "resolve", args: ["re-cinq/re-plan", "general"] });
  });

  it("lists definitions for the repo", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const agents = new Agents("re-cinq/re-plan", fakeRunner(), recordingDefs(calls), {});

    expect((await agents.list()).map((a) => a.name)).toEqual(["general"]);
    expect(calls).toContainEqual({ method: "list", args: ["re-cinq/re-plan"] });
  });

  it("delegates create/delete to the defs port with the bound repo", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const agents = new Agents("re-cinq/re-plan", fakeRunner(), recordingDefs(calls), {});

    await agents.create({
      name: "custom",
      model: "claude-opus-4-8",
      timeout_minutes: 45,
      prompt: "do {description}",
      image: null,
      execution_mode: "claude-code",
      review_required: true,
    });
    await agents.delete("custom");

    expect(calls.map((c) => c.method)).toEqual(["create", "delete"]);
    expect(calls[1].args).toEqual(["re-cinq/re-plan", "custom"]);
  });
});
