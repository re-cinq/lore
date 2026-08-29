import { describe, it, expect } from "vitest";
import {
  KubeIdentityStore,
  type IdentitySecretsApi,
} from "./kube-identity-store.js";

function fakeSecrets(initial?: Record<string, string>) {
  const secrets = new Map<string, Record<string, string>>();
  const calls: string[] = [];

  if (initial) {
    secrets.set("lore-cluster-agent-identity", initial);
  }
  const api: IdentitySecretsApi = {
    async read(name) {
      calls.push(`read:${name}`);

      return secrets.get(name) ?? null;
    },
    async create(name, stringData) {
      calls.push(`create:${name}`);
      secrets.set(name, { ...stringData });
    },
    async patch(name, stringData) {
      calls.push(`patch:${name}`);
      secrets.set(name, { ...secrets.get(name), ...stringData });
    },
  };

  return { api, secrets, calls };
}

const store = (api: IdentitySecretsApi) =>
  new KubeIdentityStore(api, "lore-cluster-agent-identity", "identity.json");

describe("KubeIdentityStore", () => {
  it("loads null before the Secret exists — first boot", async () => {
    expect(await store(fakeSecrets().api).load()).toBeNull();
  });

  it("save creates the Secret on first boot and load round-trips {id, token}", async () => {
    const { api, calls } = fakeSecrets();
    const s = store(api);

    await s.save({ id: "agent-1", token: "lca_secret" });

    expect(calls).toContain("create:lore-cluster-agent-identity");
    expect(await s.load()).toEqual({ id: "agent-1", token: "lca_secret" });
  });

  it("save on an existing Secret patches instead of re-creating", async () => {
    const { api, calls } = fakeSecrets({
      "identity.json": JSON.stringify({ id: "agent-1", token: "lca_old" }),
    });
    const s = store(api);

    await s.save({ id: "agent-1", token: "lca_rotated" });

    expect(calls.filter((c) => c.startsWith("create:"))).toEqual([]);
    expect(calls).toContain("patch:lore-cluster-agent-identity");
    expect(await s.load()).toEqual({ id: "agent-1", token: "lca_rotated" });
  });

  it("loads null from corrupt or incomplete Secret data instead of crashing", async () => {
    expect(
      await store(fakeSecrets({ "identity.json": "not json" }).api).load(),
    ).toBeNull();
    expect(
      await store(
        fakeSecrets({ "identity.json": JSON.stringify({ id: "only" }) }).api,
      ).load(),
    ).toBeNull();
  });
});
