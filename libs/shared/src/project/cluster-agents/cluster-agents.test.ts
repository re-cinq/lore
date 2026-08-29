import { describe, it, expect } from "vitest";
import { enforceTrue } from "../../lib/enforce.js";
import {
  decideRegistration,
  type RegisterClusterAgentInput,
} from "./cluster-agents-port.js";
import { InMemoryClusterAgents } from "./cluster-agents-memory.js";
import { PgClusterAgents } from "./cluster-agents-pg.js";
import { mintAgentToken, hashAgentToken } from "./cluster-agent-token.js";
import type { PgPool } from "../../memory-store.js";
import type { ClusterAgent } from "../../models/cluster-agent.js";

function fakePool(rowsByCall: unknown[][] = []): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: (rowsByCall[calls.length - 1] ?? []) as T[] };
    },
  };

  return { pool, calls };
}

const agentRow = (over: Partial<ClusterAgent> = {}): ClusterAgent => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "minikube-bogdan",
  tags: ["node:agent"],
  tokenHash: hashAgentToken("lca_current"),
  registeredAt: new Date("2026-08-26T10:00:00Z"),
  lastSeenAt: new Date("2026-08-26T10:00:00Z"),
  status: "active",
  paused: false,
  clusterInfo: null,
  ...over,
});

describe("decideRegistration", () => {
  it("returns create for an unknown name", () => {
    expect(decideRegistration(null, null)).toEqual({ kind: "create" });
  });

  it("returns refresh carrying the live token hash when the presented one matches", () => {
    const existing = agentRow();

    expect(decideRegistration(existing, existing.tokenHash)).toEqual({
      kind: "refresh",
      id: existing.id,
      tokenHash: existing.tokenHash,
    });
  });

  it("returns reject for a known name presented without the current token", () => {
    expect(decideRegistration(agentRow(), null)).toEqual({ kind: "reject" });
  });

  it("returns reject for a known name presented with a wrong token", () => {
    expect(
      decideRegistration(agentRow(), hashAgentToken("lca_stolen")),
    ).toEqual({ kind: "reject" });
  });
});

describe("mintAgentToken", () => {
  it("mints an lca_-prefixed token whose sha256 is the stored hash", () => {
    const minted = mintAgentToken(() => "abc123");

    expect(minted.token).toBe("lca_abc123");
    expect(minted.tokenHash).toBe(hashAgentToken("lca_abc123"));
    expect(minted.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mints a fresh token on every call", () => {
    expect(mintAgentToken().token).not.toBe(mintAgentToken().token);
  });
});

async function createOrFail(
  repo: InMemoryClusterAgents,
  input: RegisterClusterAgentInput,
): Promise<ClusterAgent> {
  const created = await repo.create(input);

  enforceTrue(created, Error, `name ${input.name} already registered`);

  return created;
}

describe("InMemoryClusterAgents", () => {
  it("create registers an active agent findable by name, id, and token hash", async () => {
    const repo = new InMemoryClusterAgents(
      () => new Date("2026-08-26T10:00:00Z"),
    );

    const created = await createOrFail(repo, {
      name: "minikube-bogdan",
      tags: ["node:agent", "gpu"],
      tokenHash: hashAgentToken("lca_one"),
      clusterInfo: { k8s_version: "1.30" },
    });

    expect(created).toMatchObject({
      name: "minikube-bogdan",
      tags: ["node:agent", "gpu"],
      status: "active",
      clusterInfo: { k8s_version: "1.30" },
    });
    expect(await repo.findByName("minikube-bogdan")).toEqual(created);
    expect(await repo.findById(created.id)).toEqual(created);
    expect(await repo.findByTokenHash(hashAgentToken("lca_one"))).toEqual(
      created,
    );
  });

  it("create returns null when the name is already registered", async () => {
    const repo = new InMemoryClusterAgents();

    await createOrFail(repo, {
      name: "minikube-bogdan",
      tags: [],
      tokenHash: hashAgentToken("lca_one"),
      clusterInfo: null,
    });

    expect(
      await repo.create({
        name: "minikube-bogdan",
        tags: [],
        tokenHash: hashAgentToken("lca_two"),
        clusterInfo: null,
      }),
    ).toBeNull();
    expect(await repo.list()).toHaveLength(1);
  });

  it("refresh keeps the id and name but swaps token, tags, and cluster info", async () => {
    const repo = new InMemoryClusterAgents();
    const created = await createOrFail(repo, {
      name: "minikube-bogdan",
      tags: ["node:agent"],
      tokenHash: hashAgentToken("lca_one"),
      clusterInfo: null,
    });

    const refreshed = await repo.refresh(created.id, {
      name: "minikube-bogdan",
      tags: ["node:agent", "gpu"],
      tokenHash: hashAgentToken("lca_two"),
      clusterInfo: { gpu: "h100" },
    });

    expect(refreshed).toMatchObject({
      id: created.id,
      name: "minikube-bogdan",
      tags: ["node:agent", "gpu"],
      tokenHash: hashAgentToken("lca_two"),
      clusterInfo: { gpu: "h100" },
    });
    expect(await repo.findByTokenHash(hashAgentToken("lca_one"))).toBeNull();
    expect(await repo.list()).toHaveLength(1);
  });

  it("heartbeat bumps last_seen_at and revives an offline agent to active", async () => {
    const repo = new InMemoryClusterAgents(
      () => new Date("2026-08-26T10:00:00Z"),
    );
    const created = await createOrFail(repo, {
      name: "minikube-bogdan",
      tags: [],
      tokenHash: hashAgentToken("lca_one"),
      clusterInfo: null,
    });

    await repo.markOffline(new Date("2026-08-26T10:01:00Z"));
    await repo.heartbeat(created.id, new Date("2026-08-26T10:07:00Z"));

    expect(await repo.findById(created.id)).toMatchObject({
      status: "active",
      lastSeenAt: new Date("2026-08-26T10:07:00Z"),
    });
  });

  it("setPaused flips the operator switch without touching liveness", async () => {
    const repo = new InMemoryClusterAgents();
    const created = await createOrFail(repo, {
      name: "minikube-bogdan",
      tags: ["node:agent"],
      tokenHash: hashAgentToken("lca_one"),
      clusterInfo: null,
    });

    expect(created.paused).toBe(false);
    // Paused is the operator's; status stays the reaper's. A paused agent is
    // alive — that is what keeps its in-flight work from being requeued.
    expect(await repo.setPaused(created.id, true)).toMatchObject({
      id: created.id,
      paused: true,
      status: "active",
    });
    expect((await repo.findById(created.id))?.paused).toBe(true);
    expect(await repo.setPaused(created.id, false)).toMatchObject({
      paused: false,
    });
  });

  it("setPaused returns null for an id no longer in the registry", async () => {
    expect(
      await new InMemoryClusterAgents().setPaused(
        "11111111-1111-1111-1111-111111111111",
        true,
      ),
    ).toBeNull();
  });

  it("markOffline flips only active agents silent since the cutoff and returns them", async () => {
    const repo = new InMemoryClusterAgents(
      () => new Date("2026-08-26T10:00:00Z"),
    );
    const silent = await createOrFail(repo, {
      name: "silent",
      tags: [],
      tokenHash: hashAgentToken("lca_silent"),
      clusterInfo: null,
    });
    const alive = await createOrFail(repo, {
      name: "alive",
      tags: [],
      tokenHash: hashAgentToken("lca_alive"),
      clusterInfo: null,
    });

    await repo.heartbeat(alive.id, new Date("2026-08-26T10:06:00Z"));
    const newlyOffline = await repo.markOffline(
      new Date("2026-08-26T10:05:00Z"),
    );

    expect(newlyOffline.map((a) => a.id)).toEqual([silent.id]);
    expect(await repo.findById(silent.id)).toMatchObject({ status: "offline" });
    expect(await repo.findById(alive.id)).toMatchObject({ status: "active" });
    expect(await repo.markOffline(new Date("2026-08-26T10:05:00Z"))).toEqual(
      [],
    );
  });

  it("list returns agents ordered by name", async () => {
    const repo = new InMemoryClusterAgents();

    await repo.create({
      name: "zeta",
      tags: [],
      tokenHash: hashAgentToken("lca_z"),
      clusterInfo: null,
    });
    await repo.create({
      name: "alpha",
      tags: [],
      tokenHash: hashAgentToken("lca_a"),
      clusterInfo: null,
    });

    expect((await repo.list()).map((a) => a.name)).toEqual(["alpha", "zeta"]);
  });
});

describe("PgClusterAgents adapter", () => {
  it("create inserts name, tags, token hash, and cluster info, returning the row", async () => {
    const { pool, calls } = fakePool([
      [{ id: "a-1", name: "minikube-bogdan" }],
    ]);

    await new PgClusterAgents(pool).create({
      name: "minikube-bogdan",
      tags: ["gpu"],
      tokenHash: "hash",
      clusterInfo: { region: "eu-west4" },
    });

    expect(calls[0]?.text).toContain(
      "INSERT INTO pipeline.cluster_agents (name, tags, token_hash, cluster_info)",
    );
    expect(calls[0]?.params).toEqual([
      "minikube-bogdan",
      ["gpu"],
      "hash",
      { region: "eu-west4" },
    ]);
  });

  it("refresh updates token, tags, cluster info and revives the row to active", async () => {
    const { pool, calls } = fakePool([[{ id: "a-1" }]]);

    await new PgClusterAgents(pool).refresh("a-1", {
      name: "minikube-bogdan",
      tags: ["gpu"],
      tokenHash: "hash2",
      clusterInfo: null,
    });

    expect(calls[0]?.text).toContain("UPDATE pipeline.cluster_agents");
    expect(calls[0]?.text).toContain("token_hash = $3");
    expect(calls[0]?.text).toContain("status = 'active'");
    expect(calls[0]?.params).toEqual(["a-1", ["gpu"], "hash2", null]);
  });

  it("markOffline updates only active rows past the cutoff and returns them", async () => {
    const { pool, calls } = fakePool([[]]);

    await new PgClusterAgents(pool).markOffline(
      new Date("2026-08-26T10:00:00Z"),
    );

    expect(calls[0]?.text).toContain("SET status = 'offline'");
    expect(calls[0]?.text).toContain(
      "WHERE status = 'active' AND last_seen_at < $1",
    );
  });

  it("setPaused updates only the paused column, returning the row", async () => {
    const { pool, calls } = fakePool([[{ id: "a-1" }]]);

    await new PgClusterAgents(pool).setPaused("a-1", true);

    expect(calls[0]?.text).toContain("SET paused = $2");
    expect(calls[0]?.text).toContain("WHERE id = $1");
    expect(calls[0]?.params).toEqual(["a-1", true]);
  });

  it("heartbeat sets last_seen_at and active in one statement", async () => {
    const { pool, calls } = fakePool();

    await new PgClusterAgents(pool).heartbeat(
      "a-1",
      new Date("2026-08-26T10:07:00Z"),
    );

    expect(calls[0]?.text).toContain(
      "SET last_seen_at = $2, status = 'active'",
    );
    expect(calls[0]?.params).toEqual(["a-1", new Date("2026-08-26T10:07:00Z")]);
  });
});
