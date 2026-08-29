import { describe, it, expect, vi } from "vitest";
import {
  AGENT_EVENTS_AUTH_KEY,
  agentEventsAuthHeader,
  publishesAgentEventsAuth,
  writeAgentEventsAuth,
} from "./agent-events-secret.js";
import type { SecretKeyWriter } from "../kernel/kube-token-provisioner.js";

const IDENTITY = { id: "agent-1", token: "lca_secret" };

function fakeWriter(onSet?: () => never) {
  const writes: Array<{ secret: string; key: string; value: string }> = [];
  const writer: SecretKeyWriter = {
    async setKey(secret, key, value) {
      writes.push({ secret, key, value });
      onSet?.();
    },
    async deleteKey() {},
  };

  return { writer, writes };
}

describe("agentEventsAuthHeader", () => {
  it("is the whole header line, since the subsystem sends the value verbatim", () => {
    // A bare token renders no Authorization header at all and the Floor 401s
    // every event — telemetry silently dropped.
    expect(agentEventsAuthHeader(IDENTITY)).toBe(
      "Authorization: Bearer lca_secret",
    );
  });
});

describe("writeAgentEventsAuth", () => {
  it("merges the header line into agent-secrets under the recipes' key", () => {
    const { writer, writes } = fakeWriter();

    return writeAgentEventsAuth(writer, IDENTITY).then(() => {
      expect(writes).toEqual([
        {
          secret: "agent-secrets",
          key: AGENT_EVENTS_AUTH_KEY,
          value: "Authorization: Bearer lca_secret",
        },
      ]);
    });
  });

  it("swallows a write failure — telemetry never fails a registration", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { writer } = fakeWriter(() => {
      throw new Error("secrets is forbidden");
    });

    await expect(
      writeAgentEventsAuth(writer, IDENTITY),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("run telemetry will be dropped"),
    );
    warn.mockRestore();
  });
});

describe("publishesAgentEventsAuth", () => {
  it("publishes on a cluster that holds no bus-wide token", () => {
    expect(publishesAgentEventsAuth({})).toBe(true);
  });

  it("leaves the key alone where ESO owns it", () => {
    expect(
      publishesAgentEventsAuth({ LORE_INGEST_TOKEN: "bus-wide-secret" }),
    ).toBe(false);
  });
});
