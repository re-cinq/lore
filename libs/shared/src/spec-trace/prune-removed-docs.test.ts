import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { findRepoRoot } from "../lib/repo-root.js";
import type { DgraphClientPort } from "./deps.js";
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
    ).toEqual({ outcome: "ok", candidates: ["specs/moved/spec.md"] });
  });

  it("returns nothing when the tree selection is empty", () => {
    expect(selectPruneCandidates(["specs/moved/spec.md"], [], inScope)).toEqual(
      { outcome: "ok", candidates: [] },
    );
  });

  it("leaves graph docs outside the scope filter untouched", () => {
    expect(
      selectPruneCandidates(
        ["specs/moved/spec.md", "docs/outside.md"],
        ["specs/alive/spec.md"],
        inScope,
      ),
    ).toEqual({ outcome: "ok", candidates: ["specs/moved/spec.md"] });
  });

  it("scopes a glob-chunked run to its own directory", () => {
    const chunkScope = (path: string) => path.includes("specs/auth/");

    expect(
      selectPruneCandidates(
        ["specs/auth/spec.md", "specs/billing/spec.md"],
        ["specs/auth/other.md"],
        chunkScope,
      ),
    ).toEqual({ outcome: "ok", candidates: ["specs/auth/spec.md"] });
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
          chunks(func: eq(TestChunk.repo, $repo)) { uid }
          codeChunks(func: eq(CodeChunk.repo, $repo)) { uid }
        }`,
        { $repo: repo },
      );
      const written = res.data as Record<string, { uid: string }[] | undefined>;
      const uids = Object.values(written)
        .flatMap((nodes) => nodes ?? [])
        .map((node) => node.uid);

      if (uids.length) {
        await txn.mutate({
          deleteNquads: uids.map((uid) => `<${uid}> * * .`).join("\n"),
          commitNow: true,
        });
      }
    } catch {
      void 0;
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
    const graph = (await readGraph(
      `query q($xid: string, $fp: string, $repo: string) {
        spec(func: eq(Spec.xid, $xid)) { uid }
        blocks(func: eq(Block.file_path, $fp)) @filter(eq(Block.repo, $repo)) { uid }
      }`,
      { $xid: `${repo}|${filePath}`, $fp: filePath, $repo: repo },
    )) as { spec?: unknown[]; blocks?: unknown[] };

    return {
      spec: graph.spec?.length ?? 0,
      blocks: graph.blocks?.length ?? 0,
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

    const graph = (await readGraph(
      `query q($shared: string, $solo: string) {
        shared(func: eq(TestChunk.xid, $shared)) { uid }
        solo(func: eq(TestChunk.xid, $solo)) { uid }
      }`,
      {
        $shared: `${repo}|src/shared.test.ts`,
        $solo: `${repo}|src/solo.test.ts`,
      },
    )) as { shared?: unknown[]; solo?: unknown[] };

    expect(graph.shared?.length).toBe(1);
    expect(graph.solo?.length ?? 0).toBe(0);
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

    const graph = (await readGraph(
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

    expect(graph.adr?.length ?? 0).toBe(0);
    expect(graph.blocks?.length ?? 0).toBe(0);
    expect(graph.root?.[0]?.adrs?.length ?? 0).toBe(0);
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

  function portFailingOnMutate(
    base: DgraphClientPort,
    shouldFail: (deleteNquads: string, index: number) => boolean,
  ): DgraphClientPort {
    let mutateIndex = 0;

    return {
      newTxn: () => {
        const txn = base.newTxn();

        return {
          queryWithVars: (query, vars) => txn.queryWithVars(query, vars),
          mutate: async (req) => {
            const index = mutateIndex;

            mutateIndex += 1;

            if (!shouldFail(req.deleteNquads ?? "", index)) {
              return txn.mutate(req);
            }

            throw new Error("injected dgraph failure");
          },
          discard: () => txn.discard(),
        };
      },
    };
  }

  async function countTestChunks(repo: string, file: string): Promise<number> {
    const graph = (await readGraph(
      `query q($x: string) { chunk(func: eq(TestChunk.xid, $x)) { uid } }`,
      { $x: `${repo}|${file}` },
    )) as { chunk?: unknown[] };

    return graph.chunk?.length ?? 0;
  }

  it("a failure before any node delete leaves the spec listed and a re-run completes the cleanup", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/dead/spec.md";

    await projectSpecFile(
      repo,
      specPath,
      "# D\n\n## Overview\n\n- Solo ([validated by](src/solo.test.ts#L2))\n",
      dgraphClient,
    );

    const failing = portFailingOnMutate(
      dgraphClient,
      (_nquads, index) => index === 0,
    );

    await expect(deleteSpecSubtree(failing, repo, specPath)).rejects.toThrow(
      new Error("injected dgraph failure"),
    );

    expect(await listGraphDocPaths(dgraphClient, "Spec", repo)).toEqual([
      specPath,
    ]);
    expect(await countTestChunks(repo, "src/solo.test.ts")).toBe(1);

    await deleteSpecSubtree(dgraphClient, repo, specPath);

    expect(await countRepoNodes(repo, specPath)).toEqual({
      spec: 0,
      blocks: 0,
    });
    expect(await countTestChunks(repo, "src/solo.test.ts")).toBe(0);
    expect(await listGraphDocPaths(dgraphClient, "Spec", repo)).toEqual([]);
    const feature = (await readGraph(
      `query q($fx: string) { feature(func: eq(Feature.xid, $fx)) { uid } }`,
      { $fx: `${repo}|specs/dead` },
    )) as { feature?: unknown[] };

    expect(feature.feature?.length ?? 0).toBe(0);
  });

  it("a failure on the final spec delete keeps the spec as a prune candidate and a re-run removes it", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    const specPath = "specs/dead/spec.md";

    await projectSpecFile(
      repo,
      specPath,
      "# D\n\n## Overview\n\n- Solo ([validated by](src/solo.test.ts#L2))\n",
      dgraphClient,
    );

    const failing = portFailingOnMutate(dgraphClient, (nquads) =>
      nquads.includes("<Repo.specs>"),
    );

    await expect(deleteSpecSubtree(failing, repo, specPath)).rejects.toThrow(
      new Error("injected dgraph failure"),
    );

    expect(await listGraphDocPaths(dgraphClient, "Spec", repo)).toEqual([
      specPath,
    ]);
    expect(await countRepoNodes(repo, specPath)).toEqual({
      spec: 1,
      blocks: 0,
    });
    expect(await countTestChunks(repo, "src/solo.test.ts")).toBe(0);

    await deleteSpecSubtree(dgraphClient, repo, specPath);

    expect(await countRepoNodes(repo, specPath)).toEqual({
      spec: 0,
      blocks: 0,
    });
    expect(await listGraphDocPaths(dgraphClient, "Spec", repo)).toEqual([]);
  });

  it("a failure on the final ADR delete keeps the ADR listed and a re-run removes it and its blocks", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    const adrPath = "adrs/ADR-099-dead.md";

    await projectAdrFile(
      repo,
      adrPath,
      "# ADR-099\n\nRetired.\n",
      dgraphClient,
    );

    const failing = portFailingOnMutate(dgraphClient, (nquads) =>
      nquads.includes("<Repo.adrs>"),
    );

    await expect(deleteAdrSubtree(failing, repo, adrPath)).rejects.toThrow(
      new Error("injected dgraph failure"),
    );

    expect(await listGraphDocPaths(dgraphClient, "ADR", repo)).toEqual([
      adrPath,
    ]);

    await deleteAdrSubtree(dgraphClient, repo, adrPath);

    const graph = (await readGraph(
      `query q($xid: string, $fp: string, $repo: string) {
        adr(func: eq(ADR.xid, $xid)) { uid }
        blocks(func: eq(Block.file_path, $fp)) @filter(eq(Block.repo, $repo)) { uid }
      }`,
      { $xid: `${repo}|${adrPath}`, $fp: adrPath, $repo: repo },
    )) as { adr?: unknown[]; blocks?: unknown[] };

    expect({
      adr: graph.adr?.length ?? 0,
      blocks: graph.blocks?.length ?? 0,
    }).toEqual({ adr: 0, blocks: 0 });
    expect(await listGraphDocPaths(dgraphClient, "ADR", repo)).toEqual([]);
  });

  it("deleteAdrSubtree removes an AcceptanceCriterion's trace_links back-edge when its TraceLink targets the ADR", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    const adrPath = "adrs/ADR-042-target.md";

    await projectAdrFile(
      repo,
      adrPath,
      "# ADR-042\n\nDecision.\n",
      dgraphClient,
    );

    const adrData = (await readGraph(
      `query q($xid: string) { adr(func: eq(ADR.xid, $xid)) { uid } }`,
      { $xid: `${repo}|${adrPath}` },
    )) as { adr?: Array<{ uid: string }> };
    const adrUid = adrData.adr?.[0]?.uid ?? "";

    expect(adrUid).not.toBe("");

    const acXid = `${repo}|specs/x/spec.md|ac|0`;
    const linkXid = `${repo}|manual-link|0`;
    const txn = dgraphClient.newTxn();

    try {
      await txn.mutate({
        setJson: {
          uid: "_:ac",
          "dgraph.type": "AcceptanceCriterion",
          "AcceptanceCriterion.xid": acXid,
          "AcceptanceCriterion.repo": repo,
          "AcceptanceCriterion.trace_links": [
            {
              uid: "_:link",
              "dgraph.type": "TraceLink",
              "TraceLink.xid": linkXid,
              "TraceLink.repo": repo,
              "TraceLink.target": { uid: adrUid },
            },
          ],
        },
        commitNow: true,
      });
    } finally {
      await txn.discard().catch(() => {});
    }

    await deleteAdrSubtree(dgraphClient, repo, adrPath);

    const graph = (await readGraph(
      `query q($ax: string, $lx: string) {
        ac(func: eq(AcceptanceCriterion.xid, $ax)) { uid links: AcceptanceCriterion.trace_links { uid } }
        link(func: eq(TraceLink.xid, $lx)) { uid }
      }`,
      { $ax: acXid, $lx: linkXid },
    )) as { ac?: Array<{ links?: unknown[] }>; link?: unknown[] };

    expect({
      link: graph.link?.length ?? 0,
      ac: graph.ac?.length,
      acLinks: graph.ac?.[0]?.links ?? [],
    }).toEqual({ link: 0, ac: 1, acLinks: [] });
  });

  it("keeps a TestChunk whose only other owner is another spec's AcceptanceCriterion", async () => {
    const repo = `test-prune/${randomUUID()}`;

    createdRepo = repo;
    const deadPath = "specs/dead/spec.md";
    const alivePath = "specs/alive/spec.md";

    await projectSpecFile(
      repo,
      deadPath,
      "# D\n\n## Overview\n\n- Shared ([validated by](src/shared.test.ts#L1))\n",
      dgraphClient,
    );
    await projectSpecFile(
      repo,
      alivePath,
      "# A\n\n## Acceptance Criteria\n\n1. Also shared ([validated by](src/shared.test.ts#L9))\n",
      dgraphClient,
    );

    await deleteSpecSubtree(dgraphClient, repo, deadPath);

    expect(await countTestChunks(repo, "src/shared.test.ts")).toBe(1);
  });
});

describe("selectPruneCandidates proportional fuse", () => {
  const inScope = (path: string) => path.startsWith("specs/");
  const specPaths = (count: number) =>
    Array.from({ length: count }, (_, i) => `specs/s${i}/spec.md`);

  it("refuses to prune when 7 of 10 in-scope docs vanish from the tree", () => {
    const graphDocPaths = specPaths(10);

    expect(
      selectPruneCandidates(graphDocPaths, graphDocPaths.slice(0, 3), inScope),
    ).toEqual({
      outcome: "refused-suspicious-tree",
      candidateCount: 7,
      inScopeDocCount: 10,
    });
  });

  it("allows a removal set of exactly 50% (5 of 10 in-scope docs)", () => {
    const graphDocPaths = specPaths(10);

    expect(
      selectPruneCandidates(graphDocPaths, graphDocPaths.slice(0, 5), inScope),
    ).toEqual({ outcome: "ok", candidates: graphDocPaths.slice(5) });
  });

  it("allows 2 candidates even at 100% of in-scope docs (small-set floor)", () => {
    expect(
      selectPruneCandidates(specPaths(2), ["specs/other/plan.md"], inScope),
    ).toEqual({ outcome: "ok", candidates: specPaths(2) });
  });

  it("refuses 3 candidates out of 4 in-scope docs (over 50% above the floor)", () => {
    const graphDocPaths = specPaths(4);

    expect(
      selectPruneCandidates(graphDocPaths, graphDocPaths.slice(0, 1), inScope),
    ).toEqual({
      outcome: "refused-suspicious-tree",
      candidateCount: 3,
      inScopeDocCount: 4,
    });
  });

  it("force bypasses the fuse: 7 of 10 in-scope docs all become candidates", () => {
    const graphDocPaths = specPaths(10);

    expect(
      selectPruneCandidates(
        graphDocPaths,
        graphDocPaths.slice(0, 3),
        inScope,
        true,
      ),
    ).toEqual({ outcome: "ok", candidates: graphDocPaths.slice(3) });
  });

  it("a forced run with an empty tree selection still prunes nothing", () => {
    expect(selectPruneCandidates(specPaths(3), [], inScope, true)).toEqual({
      outcome: "ok",
      candidates: [],
    });
  });

  it("measures the ratio against in-scope docs only: 20 out-of-scope paths never dilute a 3-of-4 refusal", () => {
    const outOfScope = Array.from({ length: 20 }, (_, i) => `docs/d${i}.md`);
    const graphDocPaths = [...specPaths(4), ...outOfScope];

    expect(selectPruneCandidates(graphDocPaths, specPaths(1), inScope)).toEqual(
      {
        outcome: "refused-suspicious-tree",
        candidateCount: 3,
        inScopeDocCount: 4,
      },
    );
  });

  it("returns no candidates when every graph doc falls out of scope", () => {
    expect(
      selectPruneCandidates(
        ["docs/a.md", "docs/b.md", "docs/c.md"],
        ["specs/alive/spec.md"],
        inScope,
      ),
    ).toEqual({ outcome: "ok", candidates: [] });
  });
});
