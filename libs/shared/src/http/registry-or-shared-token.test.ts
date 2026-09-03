import { describe, it, expect } from "vitest";
import Boom from "@hapi/boom";
import { enforceRegistryOrSharedToken } from "./registry-or-shared-token.js";
import {
  hashAgentToken,
  mintAgentToken,
} from "../project/cluster-agents/cluster-agent-token.js";
import type { ClusterAgent } from "../models/cluster-agent.js";

const SHARED = "shared-token";

const agent = (tokenHash: string): ClusterAgent => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "satellite-1",
  tags: [],
  tokenHash,
  registeredAt: new Date("2026-08-27T00:00:00Z"),
  lastSeenAt: new Date("2026-08-27T00:00:00Z"),
  status: "active",
  paused: false,
  clusterInfo: null,
  catalogCursor: null,
});

function registry(known: string | null) {
  const lookups: string[] = [];

  return {
    lookups,
    findByTokenHash: async (hash: string): Promise<ClusterAgent | null> => {
      lookups.push(hash);

      return known !== null && hash === known ? agent(known) : null;
    },
  };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const statusOf = async (promise: Promise<void>): Promise<number> => {
  try {
    await promise;

    return 200;
  } catch (err) {
    return Boom.isBoom(err) ? err.output.statusCode : 0;
  }
};

describe("enforceRegistryOrSharedToken", () => {
  it("accepts the shared token without consulting the registry", async () => {
    const reg = registry(null);

    await enforceRegistryOrSharedToken(
      bearer(SHARED),
      { sharedToken: SHARED, findByTokenHash: reg.findByTokenHash },
      "floor",
    );

    expect(reg.lookups).toEqual([]);
  });

  it("accepts a per-agent token whose hash matches a registry row", async () => {
    const { token, tokenHash } = mintAgentToken();
    const reg = registry(tokenHash);

    await enforceRegistryOrSharedToken(
      bearer(token),
      { sharedToken: SHARED, findByTokenHash: reg.findByTokenHash },
      "floor",
    );

    expect(reg.lookups).toEqual([hashAgentToken(token)]);
  });

  it("refuses 401 for a bearer that is neither the shared token nor registered", async () => {
    const reg = registry(null);

    expect(
      await statusOf(
        enforceRegistryOrSharedToken(
          bearer(mintAgentToken().token),
          { sharedToken: SHARED, findByTokenHash: reg.findByTokenHash },
          "floor",
        ),
      ),
    ).toBe(401);
  });

  it("refuses 401 when no bearer is presented at all", async () => {
    expect(
      await statusOf(
        enforceRegistryOrSharedToken({}, { sharedToken: SHARED }, "floor"),
      ),
    ).toBe(401);
  });

  it("names the door's own env var in the unconfigured refusal, not the ingest token", async () => {
    try {
      await enforceRegistryOrSharedToken(
        bearer("x"),
        { sharedTokenEnvName: "LORE_AGENT_INTERNAL_TOKEN" },
        "floor",
      );
      expect.unreachable("should have refused");
    } catch (err) {
      expect(Boom.isBoom(err) && err.output.payload).toMatchObject({
        error:
          "token not configured — set LORE_AGENT_INTERNAL_TOKEN on the floor deployment",
      });
    }
  });

  it("refuses 500 as an operator-fix response naming the service when the shared token is unconfigured, after the registry still admits a registered agent", async () => {
    const { token, tokenHash } = mintAgentToken();

    await enforceRegistryOrSharedToken(
      bearer(token),
      { findByTokenHash: registry(tokenHash).findByTokenHash },
      "floor",
    );

    expect(
      await statusOf(enforceRegistryOrSharedToken(bearer(token), {}, "floor")),
    ).toBe(500);
  });

  it("refuses 401 when per-agent tokens are not accepted at all", async () => {
    expect(
      await statusOf(
        enforceRegistryOrSharedToken(
          bearer(mintAgentToken().token),
          { sharedToken: SHARED },
          "floor",
        ),
      ),
    ).toBe(401);
  });
});
