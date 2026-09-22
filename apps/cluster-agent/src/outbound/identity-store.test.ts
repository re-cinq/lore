import { describe, expect, it } from "vitest";
import {
  identityStoreConfig,
  InMemoryIdentityStore,
} from "./identity-store.js";

describe("InMemoryIdentityStore", () => {
  it("starts empty and round-trips a saved identity", async () => {
    const store = new InMemoryIdentityStore();

    expect(await store.load()).toBeNull();
    await store.save({ id: "agent-9", token: "tok-xyz" });
    expect(await store.load()).toEqual({ id: "agent-9", token: "tok-xyz" });
  });
});

describe("identityStoreConfig", () => {
  it("refuses to boot when no identity Secret is named, since every cluster-agent keeps its identity in one", () => {
    expect(() => identityStoreConfig({})).toThrow(
      new Error(
        "LORE_CLUSTER_AGENT_IDENTITY_SECRET is not set — the deployment must supply it",
      ),
    );
  });

  it("chooses the Secret store with the default key when a Secret and namespace are named", () => {
    expect(
      identityStoreConfig({
        LORE_CLUSTER_AGENT_IDENTITY_SECRET: "lore-cluster-agent-identity",
        LORE_CLUSTER_AGENT_IDENTITY_NAMESPACE: "lore-cluster-agent",
      }),
    ).toEqual({
      name: "lore-cluster-agent-identity",
      namespace: "lore-cluster-agent",
      key: "identity.json",
    });
  });

  it("takes the key from LORE_CLUSTER_AGENT_IDENTITY_KEY when one is named", () => {
    expect(
      identityStoreConfig({
        LORE_CLUSTER_AGENT_IDENTITY_SECRET: "lore-cluster-agent-identity",
        LORE_CLUSTER_AGENT_IDENTITY_NAMESPACE: "lore-cluster-agent",
        LORE_CLUSTER_AGENT_IDENTITY_KEY: "satellite.json",
      }),
    ).toMatchObject({ key: "satellite.json" });
  });

  it("refuses to boot when the Secret is named but its namespace is not", () => {
    expect(() =>
      identityStoreConfig({
        LORE_CLUSTER_AGENT_IDENTITY_SECRET: "lore-cluster-agent-identity",
      }),
    ).toThrow(/LORE_CLUSTER_AGENT_IDENTITY_NAMESPACE/);
  });
});
