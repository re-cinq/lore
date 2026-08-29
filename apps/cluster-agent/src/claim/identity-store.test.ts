import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  identityStoreConfig,
  FileIdentityStore,
  InMemoryIdentityStore,
  identityFilePath,
} from "./identity-store.js";

const tempDir = (): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), "cluster-agent-identity-"));

describe("identityFilePath", () => {
  it("prefers LORE_CLUSTER_AGENT_IDENTITY_FILE over the default", () => {
    expect(
      identityFilePath({
        LORE_CLUSTER_AGENT_IDENTITY_FILE: "/mnt/secret/identity.json",
        HOME: "/home/agent",
      }),
    ).toBe("/mnt/secret/identity.json");
  });

  it("defaults to $HOME/.lore/cluster-agent-identity.json", () => {
    expect(identityFilePath({ HOME: "/home/agent" })).toBe(
      "/home/agent/.lore/cluster-agent-identity.json",
    );
  });
});

describe("FileIdentityStore", () => {
  it("loads null when the identity file does not exist", async () => {
    const dir = await tempDir();
    const store = new FileIdentityStore(path.join(dir, "missing.json"));

    expect(await store.load()).toBeNull();
  });

  it("round-trips {id, token} through save and load", async () => {
    const dir = await tempDir();
    const store = new FileIdentityStore(path.join(dir, "identity.json"));

    await store.save({ id: "agent-1", token: "tok-abc" });

    expect(await store.load()).toEqual({ id: "agent-1", token: "tok-abc" });
  });

  it("creates missing parent directories on save", async () => {
    const dir = await tempDir();
    const store = new FileIdentityStore(
      path.join(dir, "nested", "deeper", "identity.json"),
    );

    await store.save({ id: "agent-2", token: "tok-def" });

    expect(await store.load()).toEqual({ id: "agent-2", token: "tok-def" });
  });

  it("loads null from a file that is not valid JSON", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "identity.json");

    await fs.writeFile(file, "not json at all");

    expect(await new FileIdentityStore(file).load()).toBeNull();
  });

  it("loads null from JSON missing the token field", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "identity.json");

    await fs.writeFile(file, JSON.stringify({ id: "agent-3" }));

    expect(await new FileIdentityStore(file).load()).toBeNull();
  });
});

describe("InMemoryIdentityStore", () => {
  it("starts empty and round-trips a saved identity", async () => {
    const store = new InMemoryIdentityStore();

    expect(await store.load()).toBeNull();
    await store.save({ id: "agent-9", token: "tok-xyz" });
    expect(await store.load()).toEqual({ id: "agent-9", token: "tok-xyz" });
  });
});

describe("identityStoreConfig", () => {
  it("chooses the file store when no identity Secret is named", () => {
    expect(
      identityStoreConfig({ LORE_CLUSTER_AGENT_IDENTITY_FILE: "/tmp/id.json" }),
    ).toEqual({ kind: "file", path: "/tmp/id.json" });
  });

  it("chooses the Secret store with the default key when a Secret and namespace are named", () => {
    expect(
      identityStoreConfig({
        LORE_CLUSTER_AGENT_IDENTITY_SECRET: "lore-cluster-agent-identity",
        LORE_CLUSTER_AGENT_IDENTITY_NAMESPACE: "lore-cluster-agent",
      }),
    ).toEqual({
      kind: "secret",
      name: "lore-cluster-agent-identity",
      namespace: "lore-cluster-agent",
      key: "identity.json",
    });
  });

  it("refuses to boot when the Secret is named but its namespace is not", () => {
    expect(() =>
      identityStoreConfig({
        LORE_CLUSTER_AGENT_IDENTITY_SECRET: "lore-cluster-agent-identity",
      }),
    ).toThrow(/LORE_CLUSTER_AGENT_IDENTITY_NAMESPACE/);
  });
});
