import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { findRepoRoot } from "../lib/repo-root.js";
import * as dgraph from "dgraph-js-http";
import {
  selectPruneCandidates,
  listGraphDocPaths,
  deleteSpecSubtree,
  deleteAdrSubtree,
} from "./prune-removed-docs.js";
import { projectSpecFile } from "./project-spec-file.js";
import { projectAdrFile } from "./project-adr-file.js";

describe("selectPruneCandidates", () => {
  const inScope = (path: string) => path.startsWith("specs/");

  it("returns graph docs missing from the tree selection", () => {
    expect(
      selectPruneCandidates(
        ["specs/alive/spec.md", "specs/moved/spec.md"],
        ["specs/alive/spec.md"],
        inScope,
      ),
    ).toEqual(["specs/moved/spec.md"]);
  });

  it("returns nothing when the tree selection is empty", () => {
    expect(selectPruneCandidates(["specs/moved/spec.md"], [], inScope)).toEqual(
      [],
    );
  });

  it("leaves graph docs outside the scope filter untouched", () => {
    expect(
      selectPruneCandidates(
        ["specs/moved/spec.md", "docs/outside.md"],
        ["specs/alive/spec.md"],
        inScope,
      ),
    ).toEqual(["specs/moved/spec.md"]);
  });

  it("scopes a glob-chunked run to its own directory", () => {
    const chunkScope = (path: string) => path.includes("specs/auth/");

    expect(
      selectPruneCandidates(
        ["specs/auth/spec.md", "specs/billing/spec.md"],
        ["specs/auth/other.md"],
        chunkScope,
      ),
    ).toEqual(["specs/auth/spec.md"]);
  });
});

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

async function dgraphReachable(): Promise<boolean> {
  try {
    return (
      await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })
    ).ok;
  } catch {
    return false;
  }
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("whole-file pruning (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  async function readGraph(
    query: string,
    vars: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(query, vars);

      return (res.data ?? {}) as Record<string, unknown>;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  async function deleteRepoNodes(repo: string): Promise<void> {
    const txn = dgraphClient.newTxn();

    try {
      const res = await txn.queryWithVars(
        `query nodes($repo: string) {
          specs(func: eq(Spec.repo, $repo)) { uid }
          adrs(func: eq(ADR.repo, $repo)) { uid }
          root(func: eq(Repo.xid, $repo)) { uid }
          blocks(func: eq(Block.repo, $repo)) { uid }
          features(func: eq(Feature.repo, $repo)) { uid }
          statements(func: eq(Statement.repo, $repo)) { uid }
          acs(func: eq(AcceptanceCriterion.repo, $repo)) { uid }
          links(func: eq(TraceLink.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const data = res.data as Record<string, { uid: string }[] | undefined>;
      const uids = Object.values(data)
        .flatMap((nodes) => nodes ?? [])
        .map((node) => node.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      // best-effort cleanup must never mask the assertion
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  let createdRepo = "";

  afterEach(async () => {
    if (createdRepo) {
      await deleteRepoNodes(createdRepo);
    }
  });

  async function countRepoNodes(
    repo: string,
    filePath: string,
  ): Promise<Record<string, number>> {
    const data = (await readGraph(
      `query q($xid: string, $fp: string, $repo: string) {
        spec(func: eq(Spec.xid, $xid)) { uid }
        blocks(func: eq(Block.file_path, $fp)) @filter(eq(Block.repo, $repo)) { uid }
      }`,
      { $xid: `${repo}|${filePath}`, $fp: filePath, $repo: repo },
    )) as { spec?: unknown[]; blocks?: unknown[] };

    return {
      spec: data.spec?.length ?? 0,
      blocks: data.blocks?.length ?? 0,
    };
  }

  it("deleteSpecSubtree removes the spec, its children, blocks, and the Repo.specs edge while a sibling spec survives intact", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    const deadPath = "specs/dead/spec.md";
    const alivePath = "specs/alive/spec.md";
    const content =
      "# Dead\n\n## Overview\n\nThe widget MUST work.\n\n## Acceptance Criteria\n\n1. It holds.\n";

    await projectSpecFile(repo, deadPath, content, dgraphClient);
    await projectSpecFile(
      repo,
      alivePath,
      content.replace("Dead", "Alive"),
      dgraphClient,
    );

    await deleteSpecSubtree(dgraphClient, repo, deadPath);

    expect(await countRepoNodes(repo, deadPath)).toEqual({
      spec: 0,
      blocks: 0,
    });
    expect(await countRepoNodes(repo, alivePath)).toMatchObject({ spec: 1 });
    const repoEdges = (await readGraph(
      `query q($repo: string) {
        root(func: eq(Repo.xid, $repo)) { specs: Repo.specs { Spec.file_path } }
      }`,
      { $repo: repo },
    )) as { root?: Array<{ specs?: Array<Record<string, string>> }> };

    expect(
      (repoEdges.root?.[0]?.specs ?? []).map((s) => s["Spec.file_path"]),
    ).toEqual([alivePath]);
  });

  it("keeps a TestChunk still validated by another spec and deletes a solely-owned one", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    const deadPath = "specs/dead/spec.md";
    const alivePath = "specs/alive/spec.md";

    await projectSpecFile(
      repo,
      deadPath,
      "# D\n\n## Overview\n\n- Shared ([validated by](src/shared.test.ts#L1))\n- Solo ([validated by](src/solo.test.ts#L2))\n",
      dgraphClient,
    );
    await projectSpecFile(
      repo,
      alivePath,
      "# A\n\n## Overview\n\n- Also shared ([validated by](src/shared.test.ts#L9))\n",
      dgraphClient,
    );

    await deleteSpecSubtree(dgraphClient, repo, deadPath);

    const data = (await readGraph(
      `query q($shared: string, $solo: string) {
        shared(func: eq(TestChunk.xid, $shared)) { uid }
        solo(func: eq(TestChunk.xid, $solo)) { uid }
      }`,
      {
        $shared: `${repo}|src/shared.test.ts`,
        $solo: `${repo}|src/solo.test.ts`,
      },
    )) as { shared?: unknown[]; solo?: unknown[] };

    expect(data.shared?.length).toBe(1);
    expect(data.solo?.length ?? 0).toBe(0);
  });

  it("GCs the Feature when its last spec is pruned and keeps it while a sibling remains", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/feat/spec.md";
    const planPath = "specs/feat/plan.md";
    const content = "# F\n\nA point.\n";

    await projectSpecFile(repo, specPath, content, dgraphClient);
    await projectSpecFile(repo, planPath, `${content}extra`, dgraphClient);

    await deleteSpecSubtree(dgraphClient, repo, specPath);
    const afterFirst = (await readGraph(
      `query q($fx: string) { feature(func: eq(Feature.xid, $fx)) { uid } }`,
      { $fx: `${repo}|specs/feat` },
    )) as { feature?: unknown[] };

    expect(afterFirst.feature?.length).toBe(1);

    await deleteSpecSubtree(dgraphClient, repo, planPath);
    const afterSecond = (await readGraph(
      `query q($fx: string) { feature(func: eq(Feature.xid, $fx)) { uid } }`,
      { $fx: `${repo}|specs/feat` },
    )) as { feature?: unknown[] };

    expect(afterSecond.feature?.length ?? 0).toBe(0);
  });

  it("a second deleteSpecSubtree of the same path is a no-op", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/dead/spec.md";

    await projectSpecFile(repo, specPath, "# D\n\nA point.\n", dgraphClient);
    await deleteSpecSubtree(dgraphClient, repo, specPath);

    await expect(
      deleteSpecSubtree(dgraphClient, repo, specPath),
    ).resolves.toBeUndefined();
  });

  it("deleteAdrSubtree removes the ADR, its blocks, and the Repo.adrs edge", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    const adrPath = "adrs/ADR-011-dead.md";

    await projectAdrFile(
      repo,
      adrPath,
      "# ADR-011\n\nA retired decision.\n",
      dgraphClient,
    );

    await deleteAdrSubtree(dgraphClient, repo, adrPath);

    const data = (await readGraph(
      `query q($xid: string, $fp: string, $repo: string) {
        adr(func: eq(ADR.xid, $xid)) { uid }
        blocks(func: eq(Block.file_path, $fp)) @filter(eq(Block.repo, $repo)) { uid }
        root(func: eq(Repo.xid, $repo)) { adrs: Repo.adrs { uid } }
      }`,
      { $xid: `${repo}|${adrPath}`, $fp: adrPath, $repo: repo },
    )) as {
      adr?: unknown[];
      blocks?: unknown[];
      root?: Array<{ adrs?: unknown[] }>;
    };

    expect(data.adr?.length ?? 0).toBe(0);
    expect(data.blocks?.length ?? 0).toBe(0);
    expect(data.root?.[0]?.adrs?.length ?? 0).toBe(0);
  });

  it("listGraphDocPaths returns the file paths of a repo's Specs and ADRs", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    await projectSpecFile(
      repo,
      "specs/a/spec.md",
      "# A\n\nA point.\n",
      dgraphClient,
    );
    await projectAdrFile(
      repo,
      "adrs/ADR-001.md",
      "# One\n\nX.\n",
      dgraphClient,
    );

    expect(await listGraphDocPaths(dgraphClient, "Spec", repo)).toEqual([
      "specs/a/spec.md",
    ]);
    expect(await listGraphDocPaths(dgraphClient, "ADR", repo)).toEqual([
      "adrs/ADR-001.md",
    ]);
  });
});
