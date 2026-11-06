import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { anchorHashOf } from "../../domain/anchor-hash.js";
import { makeDeleteRepoNodes } from "../../outbound/spec-trace/test-helpers/delete-repo-nodes.js";
import type { DgraphClientPort } from "../../outbound/memory-store.js";
import { projectSpecFile } from "./project-spec-file.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);
const FILE_PATH = "specs/example/spec.md";
const CITED = 'it("renders messages", () => {});';
const SPEC = `## Requirements

- The widget MUST render messages. ([validated by renders messages @${anchorHashOf(CITED)}](src/widget.test.ts#L1))
- The widget MUST accept a colour prop.
- The widget MUST log every click.
`;

const reachable = await dgraphReachable();

describe.skipIf(!reachable)(
  "projectSpecFile skips unchanged statements (live Dgraph)",
  () => {
    const dgraphClient = new dgraph.DgraphClient(
      new dgraph.DgraphClientStub(DGRAPH_HTTP),
    );
    const deleteRepoNodes = makeDeleteRepoNodes(dgraphClient, [
      { alias: "specs", type: "Spec" },
      { alias: "root", type: "Repo", field: "xid" },
      { alias: "blocks", type: "Block" },
      { alias: "statements", type: "Statement" },
      { alias: "chunks", type: "TestChunk" },
    ]);
    let createdRepo = "";

    beforeAll(() => {
      execFileSync("bash", [APPLIER], {
        env: { ...process.env, DGRAPH_HTTP },
        stdio: "pipe",
      });
    });

    afterEach(async () => {
      if (createdRepo) {
        await deleteRepoNodes(createdRepo);
      }
    });

    function newRepo(): string {
      createdRepo = `test-proj/${randomUUID()}`;

      return createdRepo;
    }

    async function project(
      repo: string,
      content: string,
      options: { force?: boolean; testFile?: string } = {},
    ): Promise<string[]> {
      const counting = countingStatementUpserts(dgraphClient);

      await projectSpecFile(
        { repo, filePath: FILE_PATH, content },
        counting.port,
        {
          force: options.force,
          readLinked: async () => options.testFile ?? `${CITED}\n`,
        },
      );

      return counting.upserted;
    }

    async function statements(repo: string): Promise<StoredStatement[]> {
      const txn = dgraphClient.newTxn();

      try {
        const res = await txn.queryWithVars(STATEMENTS_QUERY, {
          $xid: `${repo}|${FILE_PATH}`,
        });
        const { spec } = res.data as {
          spec?: Array<{ statements?: StoredStatement[] }>;
        };

        return spec?.[0]?.statements ?? [];
      } finally {
        await txn.discard().catch(() => {});
      }
    }

    it("writes only the reworded third statement, and the other two keep their uids and the message statement its test link", async () => {
      const repo = newRepo();

      await project(repo, SPEC);
      const before = await statements(repo);
      const upserted = await project(
        repo,
        SPEC.replace("log every click", "log every tap"),
      );
      const after = await statements(repo);

      expect({ upserted, kept: after.slice(0, 2) }).toEqual({
        upserted: [`${repo}|${FILE_PATH}|2`],
        kept: before.slice(0, 2),
      });
    });

    it("writes the unchanged message statement again when its hashed test moved from line 1 to line 3, and its TestChunk moves to line 3", async () => {
      const repo = newRepo();

      await project(repo, SPEC);
      const upserted = await project(
        repo,
        SPEC.replace("log every click", "log every tap"),
        { testFile: ["// one", "// two", CITED].join("\n") },
      );
      const [message] = await statements(repo);

      expect({
        upserted: [...upserted].sort(),
        line: message?.["Statement.validated_by"]?.[0]?.[
          "TestChunk.start_line"
        ],
      }).toEqual({
        upserted: [`${repo}|${FILE_PATH}|0`, `${repo}|${FILE_PATH}|2`],
        line: 3,
      });
    });

    it("writes all three statements again when forced, though nothing changed", async () => {
      const repo = newRepo();

      await project(repo, SPEC);

      expect(await project(repo, SPEC, { force: true })).toHaveLength(3);
    });
  },
);

const STATEMENTS_QUERY = `query q($xid: string) {
  spec(func: eq(Spec.xid, $xid)) {
    statements: ~Statement.spec (orderasc: Statement.ordinal) {
      uid
      Statement.ordinal
      Statement.validated_by { TestChunk.xid TestChunk.start_line }
    }
  }
}`;

interface StoredStatement {
  uid: string;
  "Statement.ordinal": number;
  "Statement.validated_by"?: Array<Record<string, unknown>>;
}

function countingStatementUpserts(client: DgraphClientPort): {
  port: DgraphClientPort;
  upserted: string[];
} {
  const upserted: string[] = [];
  const port: DgraphClientPort = {
    newTxn: () => {
      const txn = client.newTxn();

      return {
        queryWithVars: (query, vars) => {
          if (query.includes("eq(Statement.xid")) {
            upserted.push(String(vars["$xid"]));
          }

          return txn.queryWithVars(query, vars);
        },
        mutate: (request) => txn.mutate(request),
        discard: () => txn.discard(),
      };
    },
  };

  return { port, upserted };
}
