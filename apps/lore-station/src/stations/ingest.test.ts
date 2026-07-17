import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIngestStation } from "./ingest.js";
import type { StationInput } from "../input.js";
import type { DgraphClientPort, DgraphTxn } from "@re-cinq/lore-shared";

/**
 * The ingest station (specs/ingest-station FR1): one pod runs one
 * internal.ingest.* payload against the LOCAL CLONE at $WORKSPACE_DIR/target
 * (the init container's checkout — no GitHub App creds in the pod, D7) and
 * writes dgraph via LORE_DGRAPH_HTTP (the FR4 scoped-egress env). Fake dgraph
 * port + a temp-dir fixture clone — no containers.
 */

function input(params: Record<string, unknown>): StationInput {
  return {
    assembly_line_id: "a1b2c3d4e5f6a7b8",
    node_id: "ingest",
    node_type: "detect",
    repo: "re-cinq/lore",
    branch: "main",
    task_id: null,
    params,
  } as StationInput;
}

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureClone(): string {
  const dir = mkdtempSync(join(tmpdir(), "ingest-station-"));

  tmpDirs.push(dir);

  mkdirSync(join(dir, "specs", "alpha"), { recursive: true });
  mkdirSync(join(dir, "adrs"), { recursive: true });
  writeFileSync(
    join(dir, "specs", "alpha", "spec.md"),
    "# Feature Specification: Alpha\n\nA lead paragraph.\n\n## Requirements\n\n- **FR1** Does the thing.\n",
  );
  writeFileSync(
    join(dir, "adrs", "ADR-001-alpha.md"),
    "# ADR-001: Alpha\n\n## Decision\n\nDo the thing.\n",
  );

  return dir;
}

function fakeDgraph(): { port: DgraphClientPort; mutations: number } {
  const state = { mutations: 0 };
  const txn: DgraphTxn = {
    queryWithVars: async () => ({ data: { found: [] } }),

    mutate: async (m: Record<string, unknown>) => {
      state.mutations += 1;
      const setJson = m["setJson"] as Record<string, unknown> | undefined;
      const uid = setJson?.["uid"] as string | undefined;

      if (uid?.startsWith("_:")) {
        return { data: { uids: { [uid.slice(2)]: `0x${state.mutations}` } } };
      }

      return { data: {} };
    },

    discard: async () => {},
  };

  return {
    port: { newTxn: () => txn },
    get mutations() {
      return state.mutations;
    },
  } as { port: DgraphClientPort; mutations: number };
}

describe("runIngestStation", () => {
  it("projects the clone's specs and reports the summary in extras", async () => {
    const fake = fakeDgraph();
    const result = await runIngestStation(input({ kind: "specs" }), {
      workspaceDir: fixtureClone(),
      dgraph: fake.port,
      embed: async () => [0.1, 0.2],
    });

    expect(result).toMatchObject({ outcome: "success" });
    expect(result.extras?.["Lore-Ingest-Summary"]).toContain("projected=1");
    expect(result.extras?.["Lore-Ingest-Summary"]).toContain("failed=0");
  });

  it("projects adrs from the clone with the adrs kind", async () => {
    const fake = fakeDgraph();
    const result = await runIngestStation(input({ kind: "adrs" }), {
      workspaceDir: fixtureClone(),
      dgraph: fake.port,
      embed: async () => [0.1, 0.2],
    });

    expect(result).toMatchObject({ outcome: "success" });
    expect(result.extras?.["Lore-Ingest-Summary"]).toContain("projected=1");
  });

  it("narrows the projection to the glob param", async () => {
    const fake = fakeDgraph();
    const clone = fixtureClone();

    mkdirSync(join(clone, "specs", "beta"), { recursive: true });
    writeFileSync(
      join(clone, "specs", "beta", "spec.md"),
      "# Feature Specification: Beta\n\nLead.\n",
    );
    const result = await runIngestStation(
      input({ kind: "specs", glob: "specs/beta/" }),
      { workspaceDir: clone, dgraph: fake.port, embed: async () => [0.1] },
    );

    expect(result.extras?.["Lore-Ingest-Summary"]).toContain("projected=1");
    expect(result.extras?.["Lore-Ingest-Summary"]).toContain("skipped=0");
  });

  it("returns outcome failed naming the files when a projection fails partially", async () => {
    const broken: DgraphTxn = {
      queryWithVars: async () => ({ data: { found: [] } }),

      mutate: async () => {
        throw new Error("Schema not defined for predicate Spec.xid");
      },

      discard: async () => {},
    };
    const result = await runIngestStation(input({ kind: "specs" }), {
      workspaceDir: fixtureClone(),
      dgraph: { newTxn: () => broken },
      embed: async () => [0.1],
    });

    expect(result).toMatchObject({ outcome: "failed" });
    expect(result.extras?.["Lore-Ingest-Failed-Files"]).toContain(
      "specs/alpha/spec.md",
    );
  });

  it('re-projects unchanged files when force is "true" (hash gate bypass)', async () => {
    const hashByXid = new Map<string, string>();
    const rememberingTxn: DgraphTxn = {
      queryWithVars: async (query: string, vars?: Record<string, string>) => {
        const xid = vars?.["$xid"];
        const hash = xid === undefined ? undefined : hashByXid.get(xid);

        if (query.includes("content_hash") && hash !== undefined) {
          return { data: { found: [{ "Spec.content_hash": hash }] } };
        }

        return { data: { found: [] } };
      },
      mutate: async (m: Record<string, unknown>) => {
        const setJson = m["setJson"] as Record<string, unknown> | undefined;
        const xid = setJson?.["Spec.xid"] as string | undefined;
        const hash = setJson?.["Spec.content_hash"] as string | undefined;

        if (xid !== undefined && hash !== undefined) {
          hashByXid.set(xid, hash);
        }

        if ((setJson?.["uid"] as string | undefined)?.startsWith("_:")) {
          const label = (setJson!["uid"] as string).slice(2);

          return { data: { uids: { [label]: `0x${hashByXid.size + 1}` } } };
        }

        return { data: {} };
      },
      discard: async () => {},
    };
    const port = { newTxn: () => rememberingTxn };
    const clone = fixtureClone();
    const run = (force?: string) =>
      runIngestStation(input({ kind: "specs", ...(force ? { force } : {}) }), {
        workspaceDir: clone,
        dgraph: port,
        embed: async () => [0.1],
      });

    expect((await run()).extras?.["Lore-Ingest-Summary"]).toContain(
      "projected=1",
    );
    expect((await run()).extras?.["Lore-Ingest-Summary"]).toContain(
      "skipped=1",
    );
    expect((await run("true")).extras?.["Lore-Ingest-Summary"]).toContain(
      "projected=1",
    );
  });

  it("rejects a payload kind until payload-by-reference lands (FR3)", async () => {
    await expect(
      runIngestStation(input({ kind: "test-report" }), {
        workspaceDir: fixtureClone(),
        dgraph: fakeDgraph().port,
        embed: async () => [0.1],
      }),
    ).rejects.toThrow(/no ingest handler for kind "test-report"/);
  });
});
