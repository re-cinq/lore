import { describe, it, expect } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import { handleRestart } from "./restart.js";

const registration = (name: string) => ({
  name,
  tags: ["node:agent"],
  tokenHash: `hash-${name}`,
  clusterInfo: null,
});

async function registered(name: string) {
  const agents = new InMemoryClusterAgents();
  const agent = await agents.create(registration(name));

  enforceTrue(agent, Error, "name already registered");

  return { agents, agent };
}

describe("handleRestart", () => {
  it("restarts the central agent", async () => {
    const { agents, agent } = await registered("central");
    let restarted = false;

    expect(
      await handleRestart(
        { agents, restart: async () => void (restarted = true) },
        agent.id,
      ),
    ).toEqual({
      code: 200,
      body: { id: agent.id, name: "central", restarted: true },
    });
    expect(restarted).toBe(true);
  });

  it("refuses a satellite — lore-api has no inbound path to it", async () => {
    const { agents, agent } = await registered("gpu-box-1");
    let restarted = false;

    expect(
      await handleRestart(
        { agents, restart: async () => void (restarted = true) },
        agent.id,
      ),
    ).toMatchObject({ code: 400 });
    expect(restarted).toBe(false);
  });

  it("returns 404 for an id no longer in the registry", async () => {
    expect(
      await handleRestart(
        { agents: new InMemoryClusterAgents(), restart: async () => {} },
        "11111111-1111-1111-1111-111111111111",
      ),
    ).toEqual({ code: 404, body: { error: "cluster agent not found" } });
  });
});
