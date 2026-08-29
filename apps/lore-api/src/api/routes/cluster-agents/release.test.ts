import { describe, expect, it } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import {
  hashAgentToken,
  mintAgentToken,
} from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import { handleRelease } from "./release.js";

const REGISTRATION = (tokenHash: string) => ({
  name: "gpu-box-1",
  tags: ["node:agent"],
  tokenHash,
  clusterInfo: null,
});

async function registered() {
  const agents = new InMemoryClusterAgents();
  const { token, tokenHash } = mintAgentToken();
  const agent = await agents.create(REGISTRATION(tokenHash));

  enforceTrue(agent, Error, "name already registered");

  return { agents, agent, token };
}

function runs(requeued: string[], answer = true) {
  return {
    requeueStationRun: async (nodeRowId: string) => {
      requeued.push(nodeRowId);

      return answer;
    },
  };
}

describe("handleRelease", () => {
  it("requeues the visit a claimant could not launch", async () => {
    const { agents, agent, token } = await registered();
    const requeued: string[] = [];

    expect(
      await handleRelease({ agents, runs: runs(requeued) }, token, agent.id, {
        node_row_id: "412",
        reason: "GitHub not configured",
      }),
    ).toEqual({ code: 200, body: { status: "requeued" } });
    expect(requeued).toEqual(["412"]);
  });

  it("answers settled for a visit that already reached an outcome", async () => {
    const { agents, agent, token } = await registered();

    expect(
      await handleRelease({ agents, runs: runs([], false) }, token, agent.id, {
        node_row_id: "412",
        reason: "boom",
      }),
    ).toEqual({ code: 200, body: { status: "settled" } });
  });

  it("refuses a caller presenting no token", async () => {
    const { agents, agent } = await registered();

    expect(
      await handleRelease({ agents, runs: runs([]) }, undefined, agent.id, {
        node_row_id: "412",
        reason: "boom",
      }),
    ).toMatchObject({ code: 401 });
  });

  it("refuses a registered agent releasing another agent's claim", async () => {
    const { agents, token } = await registered();

    expect(
      await handleRelease({ agents, runs: runs([]) }, token, "someone-else", {
        node_row_id: "412",
        reason: "boom",
      }),
    ).toMatchObject({ code: 403 });
  });

  it("refuses a token no registered agent holds", async () => {
    const { agents, agent } = await registered();

    expect(
      await handleRelease(
        { agents, runs: runs([]) },
        `lca_${hashAgentToken("nobody")}`,
        agent.id,
        { node_row_id: "412", reason: "boom" },
      ),
    ).toMatchObject({ code: 403 });
  });
});
