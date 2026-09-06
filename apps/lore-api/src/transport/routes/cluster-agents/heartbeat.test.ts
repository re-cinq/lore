import { describe, it, expect } from "vitest";
import { handleHeartbeat } from "./heartbeat.js";
import { handleRegister } from "./register.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";

const REG_TOKEN = "reg-secret";

async function registeredAgent(repository: InMemoryClusterAgents) {
  const result = await handleRegister(
    { repository, registrationToken: REG_TOKEN },
    REG_TOKEN,
    { name: "minikube", tags: [], cluster_info: null },
  );

  enforceTrue(result.code === 200, Error, "unreachable");

  return result.body;
}

describe("handleHeartbeat", () => {
  it("rejects 401 without a bearer and 403 on a foreign or unknown token", async () => {
    const repository = new InMemoryClusterAgents();
    const agent = await registeredAgent(repository);
    const deps = { agents: repository, now: () => new Date() };

    expect(await handleHeartbeat(deps, undefined, agent.id)).toMatchObject({
      code: 401,
    });
    expect(await handleHeartbeat(deps, "lca_unknown", agent.id)).toMatchObject({
      code: 403,
    });
    expect(
      await handleHeartbeat(deps, agent.token, "some-other-id"),
    ).toMatchObject({ code: 403 });
  });

  it("bumps last_seen_at to now and revives an offline agent to active", async () => {
    const repository = new InMemoryClusterAgents(
      () => new Date("2026-08-26T10:00:00Z"),
    );
    const agent = await registeredAgent(repository);

    await repository.markOffline(new Date("2026-08-26T10:06:00Z"));
    const beat = new Date("2026-08-26T10:07:30Z");

    expect(
      await handleHeartbeat(
        { agents: repository, now: () => beat },
        agent.token,
        agent.id,
      ),
    ).toEqual({ code: 200, body: { status: "ok" } });
    expect(await repository.findById(agent.id)).toMatchObject({
      status: "active",
      lastSeenAt: beat,
    });
  });
});
