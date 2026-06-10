import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { projectSpecFile } from "../project-spec-file.js";
import { resolveSentenceLink } from "../resolve-sentence-link.js";

/**
 * resolveSentenceLink (spec-traceability-graph) — resolves a `<spec> | <sentence>`
 * test name against the live graph: the `<spec>` segment substring-matches a
 * Spec.title, the `<sentence>` substring-matches a Statement/AcceptanceCriterion
 * under that spec (shallow: lowercase, whitespace-free, link-parens stripped).
 * Tested against live Dgraph (no mocks); container-gated.
 */

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const REPO_ROOT = join(process.cwd(), "..");
const APPLIER = join(REPO_ROOT, "scripts", "infra", "setup-spec-trace-schema.sh");

async function dgraphReachable(): Promise<boolean> {
  try {
    return (await fetch(`${DGRAPH_HTTP}/health`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("resolveSentenceLink (live Dgraph)", () => {
  const dgraphClient = new dgraph.DgraphClient(new dgraph.DgraphClientStub(DGRAPH_HTTP));

  beforeAll(() => {
    execFileSync("bash", [APPLIER], { env: { ...process.env, DGRAPH_HTTP }, stdio: "pipe" });
  });

  async function xidUid(xid: string): Promise<string | undefined> {
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(
        `query q($xid: string) { n(func: eq(Statement.xid, $xid)) { uid } }`,
        { $xid: xid },
      );
      return (res.data as { n?: { uid: string }[] }).n?.[0]?.uid;
    } finally {
      await txn.discard().catch(() => {});
    }
  }

  let createdRepo = "";
  afterEach(async () => {
    if (!createdRepo) return;
    const txn = dgraphClient.newTxn();
    try {
      const res = await txn.queryWithVars(
        `query q($r: string) { specs(func: eq(Spec.repo, $r)) { uid } blocks(func: eq(Block.repo, $r)) { uid } }`,
        { $r: createdRepo },
      );
      const data = res.data as { specs?: { uid: string }[]; blocks?: { uid: string }[] };
      const uids = [...(data.specs ?? []), ...(data.blocks ?? [])].map((n) => n.uid);
      if (uids.length) {
        await txn.mutate({ deleteNquads: uids.map((u) => `<${u}> * * .`).join("\n"), commitNow: true });
      }
    } catch {
      // best-effort
    } finally {
      await txn.discard().catch(() => {});
    }
  });

  it("resolves a spec-title + statement-sentence test name to the statement uid", async () => {
    const repo = `test-sent/${randomUUID()}`;
    createdRepo = repo;
    const filePath = "specs/example/spec.md";
    const content =
      "# Feature Specification: Widget Service\n\n## Success Criteria\n\n1. Onboarding a new repo produces a\n   PR within 5 minutes\n";
    await projectSpecFile(repo, filePath, content, dgraphClient, async () => null);

    const matched = await resolveSentenceLink(dgraphClient, repo, {
      spec: "Widget Service",
      sentence: "Onboarding a new repo produces a PR within 5 minutes",
      label: "produces a PR",
    });

    const expectedUid = await xidUid(`${repo}|${filePath}|0`);
    expect(matched).toEqual([{ uid: expectedUid, nodeType: "Statement" }]);
  });

  it("returns an empty array when the sentence matches no statement", async () => {
    const repo = `test-sent/${randomUUID()}`;
    createdRepo = repo;
    await projectSpecFile(
      repo,
      "specs/example/spec.md",
      "# Feature Specification: Widget Service\n\n## Success Criteria\n\n1. A real criterion.\n",
      dgraphClient,
      async () => null,
    );

    const matched = await resolveSentenceLink(dgraphClient, repo, {
      spec: "Widget Service",
      sentence: "this sentence is nowhere in the spec",
      label: "x",
    });

    expect(matched).toEqual([]);
  });
});
