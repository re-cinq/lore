import { describe, it, expect } from "vitest";
import { handleCatalogEvents } from "./catalog-events.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import { InMemoryCatalogEvents } from "@re-cinq/lore-shared/project/agents/catalog-events-memory.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import type { ResolvedAgentDefinition } from "@re-cinq/lore-shared/models/agent-definition.js";

const TOKEN = "lca_minikube_secret";

const def = (
  name: string,
  projectId: string | null = null,
): ResolvedAgentDefinition => ({
  name,
  model: "claude-sonnet-4-6",
  timeout_minutes: 30,
  prompt: "Do the thing.",
  image: null,
  execution_mode: "claude-code",
  review_required: false,
  project_id: projectId,
  config: null,
});

async function harness(definitions: Map<string, ResolvedAgentDefinition>) {
  const agents = new InMemoryClusterAgents();
  const agent = await agents.create({
    name: "minikube",
    tags: [],
    tokenHash: hashAgentToken(TOKEN),
    clusterInfo: null,
  });

  enforceTrue(agent, Error, "name already registered");
  const events = new InMemoryCatalogEvents();
  const deps = {
    agents,
    events,
    resolveEntry: async (name: string, projectId: string | null) =>
      definitions.get(`${name} ${projectId ?? ""}`) ?? null,
  };

  return { agents, agent, events, deps };
}

describe("handleCatalogEvents", () => {
  it("rejects 401 without a bearer token", async () => {
    const { deps, agent } = await harness(new Map());

    expect(await handleCatalogEvents(deps, undefined, agent.id)).toEqual({
      code: 401,
      body: { error: "unauthorized" },
    });
  });

  it("rejects 403 when the token holder claims another agent's id", async () => {
    const { deps } = await harness(new Map());

    expect(await handleCatalogEvents(deps, TOKEN, "someone-else")).toEqual({
      code: 403,
      body: { error: "forbidden" },
    });
  });

  it("a never-resynced agent gets the full snapshot with resolved definitions and the cursor to ack", async () => {
    const { deps, agent, events } = await harness(
      new Map([["implementation ", def("implementation")]]),
    );

    events.setEntries([{ name: "implementation", projectId: null }]);
    events.append("implementation", null, "upsert");

    const result = await handleCatalogEvents(deps, TOKEN, agent.id);

    expect(result).toEqual({
      code: 200,
      body: {
        mode: "snapshot",
        cursor: "1",
        entries: [
          {
            name: "implementation",
            project_id: null,
            definition: def("implementation"),
          },
        ],
      },
    });
  });

  it("a requested snapshot re-serves the full catalog even for an agent with a stored cursor (boot resync)", async () => {
    const { deps, agent, agents, events } = await harness(
      new Map([["implementation ", def("implementation")]]),
    );

    events.setEntries([{ name: "implementation", projectId: null }]);
    events.append("implementation", null, "upsert");
    events.append("deleted-thing", null, "delete");
    await agents.advanceCatalogCursor(agent.id, "1");

    const result = await handleCatalogEvents(deps, TOKEN, agent.id, {
      snapshot: true,
    });

    expect(result).toEqual({
      code: 200,
      body: {
        mode: "snapshot",
        cursor: "1",
        entries: [
          {
            name: "implementation",
            project_id: null,
            definition: def("implementation"),
          },
        ],
      },
    });
  });

  it("the same tail is re-served until the agent acks it, then only newer events follow", async () => {
    const { deps, agent, agents, events } = await harness(
      new Map([
        ["implementation ", def("implementation")],
        ["review ", def("review")],
      ]),
    );

    await agents.advanceCatalogCursor(agent.id, "0");
    events.append("implementation", null, "upsert");

    const first = await handleCatalogEvents(deps, TOKEN, agent.id);
    const replayed = await handleCatalogEvents(deps, TOKEN, agent.id);

    expect(first).toEqual(replayed);
    enforceTrue(first.code === 200, Error, "expected 200");

    events.append("review", null, "upsert");
    const afterAck = await handleCatalogEvents(deps, TOKEN, agent.id, {
      ack: first.body.cursor,
    });

    expect(afterAck).toEqual({
      code: 200,
      body: {
        mode: "tail",
        cursor: "2",
        entries: [
          { name: "review", project_id: null, definition: def("review") },
        ],
      },
    });
  });

  it("a deleted override resolves to a null definition, the delete-the-CRDs signal", async () => {
    const { deps, agent, agents, events } = await harness(new Map());

    await agents.advanceCatalogCursor(agent.id, "0");
    events.append("implementation", "p-1", "delete");

    const result = await handleCatalogEvents(deps, TOKEN, agent.id);

    expect(result).toEqual({
      code: 200,
      body: {
        mode: "tail",
        cursor: "1",
        entries: [
          { name: "implementation", project_id: "p-1", definition: null },
        ],
      },
    });
  });

  it("rapid saves of one entry collapse into a single resolved entry per tail", async () => {
    const { deps, agent, agents, events } = await harness(
      new Map([["implementation ", def("implementation")]]),
    );

    await agents.advanceCatalogCursor(agent.id, "0");
    events.append("implementation", null, "upsert");
    events.append("implementation", null, "upsert");
    events.append("implementation", null, "upsert");

    const result = await handleCatalogEvents(deps, TOKEN, agent.id);

    enforceTrue(result.code === 200, Error, "expected 200");
    expect(result.body.entries).toHaveLength(1);
    expect(result.body.cursor).toEqual("3");
  });

  it("an empty tail answers with the stored cursor and no entries", async () => {
    const { deps, agent, agents } = await harness(new Map());

    await agents.advanceCatalogCursor(agent.id, "5");

    expect(await handleCatalogEvents(deps, TOKEN, agent.id)).toEqual({
      code: 200,
      body: { mode: "tail", cursor: "5", entries: [] },
    });
  });
});
