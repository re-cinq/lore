import { describe, expect, it } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { InMemoryClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-memory.js";
import {
  hashAgentToken,
  mintAgentToken,
} from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import type {
  StationRunRelease,
  StationRunReleaseResult,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
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

function runs(
  released: Array<{ nodeRowId: string; release: StationRunRelease }>,
  { answer = "requeued" }: RunsAnswer = {},
) {
  return {
    releaseStationRun: async (
      nodeRowId: string,
      release: StationRunRelease,
    ) => {
      released.push({ nodeRowId, release });

      return answer;
    },
  };
}

describe("handleRelease", () => {
  it("requeues a visit whose launch error is not permanent, under a bound of 3 attempts", async () => {
    const { agents, agent, token } = await registered();
    const released: Array<{ nodeRowId: string; release: StationRunRelease }> =
      [];

    expect(
      await handleRelease(
        { agents, runs: runs(released), maxLaunchAttempts: 3 },
        token,
        agent.id,
        {
          node_row_id: "412",
          reason: "GitHub not configured",
        },
      ),
    ).toEqual({ code: 200, body: { status: "requeued" } });
    expect(released).toEqual([
      {
        nodeRowId: "412",
        release: {
          reason: "GitHub not configured",
          failureClass: "unknown",
          permanent: false,
          maxAttempts: 3,
        },
      },
    ]);
  });

  it("fails at once a visit whose installation token was refused, as github-permission", async () => {
    const { agents, agent, token } = await registered();
    const released: Array<{ nodeRowId: string; release: StationRunRelease }> =
      [];
    const reason =
      "There is at least one repository that does not exist or is not accessible to the parent installation.";

    expect(
      await handleRelease(
        {
          agents,
          runs: runs(released, { answer: "failed" }),
          maxLaunchAttempts: 3,
        },
        token,
        agent.id,
        { node_row_id: "412", reason },
      ),
    ).toEqual({ code: 200, body: { status: "failed" } });
    expect(released[0]?.release).toEqual({
      reason,
      failureClass: "github-permission",
      permanent: true,
      maxAttempts: 3,
    });
  });

  it("answers settled for a visit that already reached an outcome", async () => {
    const { agents, agent, token } = await registered();

    expect(
      await handleRelease(
        { agents, runs: runs([], { answer: "settled" }), maxLaunchAttempts: 3 },
        token,
        agent.id,
        {
          node_row_id: "412",
          reason: "boom",
        },
      ),
    ).toEqual({ code: 200, body: { status: "settled" } });
  });

  it("refuses a caller presenting no token", async () => {
    const { agents, agent } = await registered();

    expect(
      await handleRelease(
        { agents, runs: runs([]), maxLaunchAttempts: 3 },
        undefined,
        agent.id,
        {
          node_row_id: "412",
          reason: "boom",
        },
      ),
    ).toMatchObject({ code: 401 });
  });

  it("refuses a registered agent releasing another agent's claim", async () => {
    const { agents, token } = await registered();

    expect(
      await handleRelease(
        { agents, runs: runs([]), maxLaunchAttempts: 3 },
        token,
        "someone-else",
        {
          node_row_id: "412",
          reason: "boom",
        },
      ),
    ).toMatchObject({ code: 403 });
  });

  it("refuses a token no registered agent holds", async () => {
    const { agents, agent } = await registered();

    expect(
      await handleRelease(
        { agents, runs: runs([]), maxLaunchAttempts: 3 },
        `lca_${hashAgentToken("nobody")}`,
        agent.id,
        { node_row_id: "412", reason: "boom" },
      ),
    ).toMatchObject({ code: 403 });
  });
});

interface RunsAnswer {
  answer?: StationRunReleaseResult;
}
