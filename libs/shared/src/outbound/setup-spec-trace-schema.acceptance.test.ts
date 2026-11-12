import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../lib/repo-root.js";
import { dgraphReachable } from "../lib/dgraph-test-gate.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

function applySchema(): void {
  execFileSync("bash", [APPLIER], {
    env: { ...process.env, DGRAPH_HTTP },
    stdio: "pipe",
  });
}

async function querySchema(
  dql: string,
): Promise<{ schema: Array<Record<string, unknown>> }> {
  const res = await fetch(`${DGRAPH_HTTP}/query`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: { "Content-Type": "application/dql" },
    body: dql,
  });

  return (await res.json()).data;
}

const reachable = await dgraphReachable();

describe.skipIf(!reachable)(
  "T214: Spec.blocks schema reconciliation (live Dgraph)",
  () => {
    beforeAll(() => applySchema());

    it("declares Spec.blocks as a uid list predicate", async () => {
      const { schema } = await querySchema(
        `schema(pred: [Spec.blocks]) {type list reverse count}`,
      );
      const byPred = Object.fromEntries(schema.map((s) => [s.predicate, s]));

      expect(
        byPred["Spec.blocks"],
        "Spec.blocks should be a uid list",
      ).toMatchObject({
        type: "uid",
        list: true,
      });
    });

    it("lists Spec.blocks in the Spec type", async () => {
      const res = await fetch(`${DGRAPH_HTTP}/query`, {
        signal: AbortSignal.timeout(30_000),
        method: "POST",
        headers: { "Content-Type": "application/dql" },
        body: "schema(type: Spec) {}",
      });
      const types = (await res.json()).data.types as Array<{
        name: string;
        fields: Array<{ name: string }>;
      }>;
      const specType = types.find((t) => t.name === "Spec");
      const fields = (specType?.fields ?? []).map((f) => f.name);

      expect(fields).toContain("Spec.blocks");
    });
  },
);
