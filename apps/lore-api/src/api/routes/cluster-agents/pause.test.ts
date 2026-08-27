import { describe, it, expect } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import { handleSetPaused } from "./pause.js";

const registration = (name = "minikube") => ({
  name,
  tags: ["node:agent"],
  tokenHash: `hash-${name}`,
  clusterInfo: null,
});

async function registered() {
  const agents = new InMemoryClusterAgents();
  const agent = await agents.create(registration());

  enforceTrue(agent, Error, "name already registered");

  return { agents, agent };
}

describe("handleSetPaused", () => {
  it("pauses a registered agent and reports the new state", async () => {
    const { agents, agent } = await registered();

    expect(
      await handleSetPaused({ agents }, agent.id, { paused: true }),
    ).toEqual({
      code: 200,
      body: { id: agent.id, name: "minikube", paused: true },
    });
    expect((await agents.findById(agent.id))?.paused).toBe(true);
  });

  it("un-pauses, so the switch is a toggle and not a one-way door", async () => {
    const { agents, agent } = await registered();

    await handleSetPaused({ agents }, agent.id, { paused: true });

    expect(
      await handleSetPaused({ agents }, agent.id, { paused: false }),
    ).toMatchObject({ code: 200, body: { paused: false } });
  });

  it("leaves liveness alone — a paused agent is alive, not lost", async () => {
    // The whole point of pause over scale-to-zero: `status` stays the reaper's,
    // so nothing this agent already claimed gets requeued out from under it.
    const { agents, agent } = await registered();

    await handleSetPaused({ agents }, agent.id, { paused: true });

    expect((await agents.findById(agent.id))?.status).toBe("active");
  });

  it("returns 404 for an id no longer in the registry", async () => {
    expect(
      await handleSetPaused(
        { agents: new InMemoryClusterAgents() },
        "11111111-1111-1111-1111-111111111111",
        { paused: true },
      ),
    ).toEqual({ code: 404, body: { error: "cluster agent not found" } });
  });
});
