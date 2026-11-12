import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { findRepoRoot } from "../../lib/repo-root.js";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { projectSpecFile } from "./project-spec-file.js";
import { projectAdrFile } from "./project-adr-file.js";
import { recomputeFile } from "../../outbound/spec-trace/recompute-spec-file.js";
import { makeDeleteRepoNodes } from "../../outbound/spec-trace/test-helpers/delete-repo-nodes.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const reachable = await dgraphReachable();

describe.skipIf(!reachable)(
  "Block pruning on re-projection (live Dgraph)",
  () => {
    const dgraphClient = new dgraph.DgraphClient(
      new dgraph.DgraphClientStub(DGRAPH_HTTP),
    );

    const deleteRepoNodes = makeDeleteRepoNodes(dgraphClient, [
      { alias: "specs", type: "Spec" },
      { alias: "adrs", type: "ADR" },
      { alias: "blocks", type: "Block" },
      { alias: "root", type: "Repo", field: "xid" },
    ]);

    let createdRepo: string | undefined;

    beforeAll(() => {
      execFileSync("bash", [APPLIER], {
        env: { ...process.env, DGRAPH_HTTP },
        stdio: "pipe",
      });
    });

    afterEach(async () => {
      if (createdRepo) {
        await deleteRepoNodes(createdRepo);
        createdRepo = undefined;
      }
    });

    it("recomputes the shorter source when re-projecting fewer blocks prunes the orphaned Blocks", async () => {
      const repo = `test-proj/${randomUUID()}`;

      createdRepo = repo;
      const filePath = "specs/example/spec.md";
      const longContent = ["# Title", "", "Para one.", "", "Para two."].join(
        "\n",
      );
      const shortContent = "# Title";

      await projectSpecFile(
        { repo, filePath, content: longContent },
        dgraphClient,
      );
      await projectSpecFile(
        { repo, filePath, content: shortContent },
        dgraphClient,
      );

      const recomputed = await recomputeFile(repo, filePath, dgraphClient);

      expect(recomputed).toBe(shortContent);
    });

    it("recomputes the shorter source after re-projecting a SHORTER ADR over a longer one", async () => {
      const repo = `test-adr/${randomUUID()}`;

      createdRepo = repo;
      const filePath = "adrs/0016.md";
      const longContent = [
        "# ADR-016",
        "",
        "## Status",
        "",
        "Accepted",
        "",
        "## Context",
        "",
        "Old context.",
      ].join("\n");
      const shortContent = ["# ADR-016", "", "## Status", "", "Accepted"].join(
        "\n",
      );

      await projectAdrFile(
        { repo, filePath, content: longContent },
        dgraphClient,
      );
      await projectAdrFile(
        { repo, filePath, content: shortContent },
        dgraphClient,
      );
      const recomputed = await recomputeFile(repo, filePath, dgraphClient);

      expect(recomputed).toBe(shortContent);
    });
  },
);
