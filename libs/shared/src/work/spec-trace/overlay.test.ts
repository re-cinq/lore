import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { overlayScope } from "../../domain/spec-trace/trace-scope.js";
import { upsertByXid } from "../../outbound/spec-trace/dgraph-upsert.js";
import {
  upsertOverlay,
  readOverlay,
  dropOverlay,
  listOverlays,
  pruneOverlays,
} from "./overlay.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("overlay lifecycle (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  it("reads back the branch and head commit an upserted overlay was stamped with", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const branch = "lore/impl/issue-1";

    await upsertOverlay(client, overlayScope(repo, branch), {
      headCommit: "abc123",
    });

    expect(await readOverlay(client, repo, branch)).toMatchObject({
      repo,
      branch,
      headCommit: "abc123",
    });

    await dropOverlay(client, repo, branch);
  });

  it("returns null for a branch that never wrote an overlay", async () => {
    expect(
      await readOverlay(client, `spec-trace/${randomUUID()}`, "feat/none"),
    ).toBeNull();
  });

  it("restamps head commit on a second push to the branch rather than creating a second overlay", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const scope = overlayScope(repo, "feat/x");

    await upsertOverlay(client, scope, { headCommit: "first" });
    await upsertOverlay(client, scope, { headCommit: "second" });

    expect(await listOverlays(client, repo)).toEqual([
      expect.objectContaining({ branch: "feat/x", headCommit: "second" }),
    ]);

    await dropOverlay(client, repo, "feat/x");
  });

  it("deletes the anchored chunks and the anchor, leaving no overlay for the branch", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const scope = overlayScope(repo, "feat/x");
    const overlayUid = await upsertOverlay(client, scope, {
      headCommit: "sha",
    });
    const chunkUid = await upsertByXid(
      client,
      "TestChunk",
      `${scope.key}|src/a.test.ts`,
      { "TestChunk.repo": scope.key, "TestChunk.file_path": "src/a.test.ts" },
    );

    await upsertByXid(client, "Overlay", scope.key, {
      "Overlay.test_chunks": [{ uid: chunkUid }],
    });

    const deleted = await dropOverlay(client, repo, "feat/x");

    expect({
      deleted,
      overlay: await readOverlay(client, repo, "feat/x"),
      anchor: await readNode(client, overlayUid),
      chunk: await readNode(client, chunkUid),
    }).toEqual({ deleted: 2, overlay: null, anchor: null, chunk: null });
  });

  it("drops nothing and reports zero for a branch with no overlay", async () => {
    expect(
      await dropOverlay(client, `spec-trace/${randomUUID()}`, "feat/none"),
    ).toBe(0);
  });

  it("lists only the overlays of the repo it was asked about", async () => {
    const repo = `spec-trace/${randomUUID()}`;
    const other = `spec-trace/${randomUUID()}`;

    await upsertOverlay(client, overlayScope(repo, "feat/x"), {
      headCommit: "sha",
    });
    await upsertOverlay(client, overlayScope(other, "feat/x"), {
      headCommit: "sha",
    });

    expect(await listOverlays(client, repo)).toEqual([
      expect.objectContaining({ repo, branch: "feat/x" }),
    ]);

    await dropOverlay(client, repo, "feat/x");
    await dropOverlay(client, other, "feat/x");
  });
});

async function readNode(
  client: dgraph.DgraphClient,
  uid: string,
): Promise<Record<string, unknown> | null> {
  const txn = client.newTxn();

  try {
    const res = await txn.queryWithVars(
      `query q($uid: string) { n(func: uid($uid)) { uid expand(_all_) } }`,
      { $uid: uid },
    );
    const found = res.data as { n?: Record<string, unknown>[] };
    const rows = found.n ?? [];

    return rows.length && Object.keys(rows[0]).length > 1 ? rows[0] : null;
  } finally {
    await txn.discard().catch(() => {});
  }
}

describe.skipIf(!reachable)("pruneOverlays (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  it("drops an overlay written before the cutoff", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await upsertOverlay(client, overlayScope(repo, "feat/old"), {
      headCommit: "sha",
      at: new Date("2020-01-01T00:00:00.000Z"),
    });

    expect({
      dropped: await pruneOverlays(client, repo, new Date("2021-01-01Z")),
      left: await listOverlays(client, repo),
    }).toEqual({ dropped: 1, left: [] });
  });

  it("keeps an overlay written after the cutoff, because its branch may still be pushing", async () => {
    const repo = `spec-trace/${randomUUID()}`;

    await upsertOverlay(client, overlayScope(repo, "feat/new"), {
      headCommit: "sha",
      at: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(await pruneOverlays(client, repo, new Date("2021-01-01Z"))).toBe(0);

    await dropOverlay(client, repo, "feat/new");
  });
});
