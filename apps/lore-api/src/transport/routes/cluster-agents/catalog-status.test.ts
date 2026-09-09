import { describe, it, expect } from "vitest";
import { handleCatalogStatus } from "./catalog-status.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import { InMemoryCatalogStatus } from "@re-cinq/lore-shared/project/agents/catalog-status-memory.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";

const TOKEN = "lca_minikube_secret";

async function harness() {
  const agents = new InMemoryClusterAgents();
  const agent = await agents.create({
    name: "minikube",
    tags: [],
    tokenHash: hashAgentToken(TOKEN),
    clusterInfo: null,
  });

  enforceTrue(agent, Error, "name already registered");
  const status = new InMemoryCatalogStatus({ [agent.id]: "minikube" });

  return { agent, status, deps: { agents, status } };
}

const body = {
  reports: [
    {
      name: "implementation",
      project_id: null,
      state: "applied",
      reason: null,
    },
    {
      name: "review",
      project_id: null,
      state: "refused",
      reason: "no anthropic credential",
    },
  ],
};

describe("handleCatalogStatus", () => {
  it("records every reported verdict, reason included", async () => {
    const { agent, status, deps } = await harness();

    expect(await handleCatalogStatus(deps, TOKEN, agent.id, body)).toEqual({
      code: 200,
      body: { ok: true, recorded: 2 },
    });
    expect(await status.list()).toMatchObject([
      { name: "implementation", state: "applied", clusterName: "minikube" },
      { name: "review", state: "refused", reason: "no anthropic credential" },
    ]);
  });

  it("rejects 401 without a bearer token and 403 for another agent's id", async () => {
    const { agent, deps } = await harness();

    expect(await handleCatalogStatus(deps, undefined, agent.id, body)).toEqual({
      code: 401,
      body: { error: "unauthorized" },
    });
    expect(
      await handleCatalogStatus(deps, TOKEN, "someone-else", body),
    ).toEqual({ code: 403, body: { error: "forbidden" } });
  });

  it("rejects a malformed report rather than recording half of it", async () => {
    const { agent, status, deps } = await harness();
    const bad = {
      reports: [{ name: "x", project_id: null, state: "exploded" }],
    };

    expect(await handleCatalogStatus(deps, TOKEN, agent.id, bad)).toEqual({
      code: 400,
      body: { error: "invalid report" },
    });
    expect(await status.list()).toEqual([]);
  });

  it("a later report replaces the earlier verdict, so a fixed refusal stops being shown", async () => {
    const { agent, status, deps } = await harness();

    await handleCatalogStatus(deps, TOKEN, agent.id, body);
    await handleCatalogStatus(deps, TOKEN, agent.id, {
      reports: [
        { name: "review", project_id: null, state: "applied", reason: null },
      ],
    });

    expect(await status.list()).toMatchObject([
      { name: "implementation", state: "applied" },
      { name: "review", state: "applied", reason: null },
    ]);
  });
});
