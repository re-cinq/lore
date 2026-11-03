import { describe, expect, it } from "vitest";
import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";
import {
  mainScope,
  overlayScope,
} from "../../domain/spec-trace/trace-scope.js";
import { listTestFilePaths, pruneUnreportedTests } from "./prune-test-files.js";

type Rows = Record<string, Array<Record<string, unknown>>>;

function graphHolding(rowsFor: (file: string) => Rows) {
  const deletes: string[] = [];
  const queriedFiles: string[] = [];
  const client = {
    newTxn: () => ({
      queryWithVars: async (_query: string, vars: Record<string, string>) => {
        queriedFiles.push(vars.$file ?? "");

        return { data: rowsFor(vars.$file ?? "") };
      },
      mutate: async (req: { deleteNquads: string }) => {
        deletes.push(...req.deleteNquads.split("\n"));
      },
      discard: async () => undefined,
    }),
  } as unknown as DgraphClientPort;

  return { client, deletes, queriedFiles };
}

const repo = "re-cinq/lore";
const file = "src/a.test.ts";
const renamed = { id: "src/a.test.ts::sums", name: "sums", file };

describe("pruneUnreportedTests", () => {
  it("deletes the renamed test's row and coverage and keeps the listed test and the file's own row", async () => {
    const { client, deletes } = graphHolding(() => ({
      chunks: [
        { uid: "0xf", xid: `${repo}|${file}` },
        { uid: "0x1", xid: `${repo}|${renamed.id}` },
        {
          uid: "0x2",
          xid: `${repo}|src/a.test.ts::adds`,
          covOut: [{ uid: "0xc" }],
        },
      ],
      root: [{ uid: "0xr" }],
    }));

    await pruneUnreportedTests(client, mainScope(repo), [renamed]);

    expect(deletes).toEqual([
      "<0x2> * * .",
      "<0xc> * * .",
      "<0xr> <Repo.test_chunks> <0x2> .",
      "<0xr> <Repo.coverage> <0xc> .",
    ]);
  });

  it("deletes a suite the report no longer names and keeps every level of a listed chain", async () => {
    const { client, deletes } = graphHolding(() => ({
      suites: [
        { uid: "0x1", xid: `${repo}|${file}|outer` },
        { uid: "0x2", xid: `${repo}|${file}|outer>inner` },
        { uid: "0x3", xid: `${repo}|${file}|old` },
      ],
      root: [{ uid: "0xr" }],
    }));

    await pruneUnreportedTests(client, mainScope(repo), [
      { ...renamed, suite: ["outer", "inner"] },
    ]);

    expect(deletes).toEqual([
      "<0x3> * * .",
      "<0xr> <Repo.test_suites> <0x3> .",
    ]);
  });

  it("deletes nothing when the report lists everything the graph holds under the file", async () => {
    const { client, deletes } = graphHolding(() => ({
      chunks: [
        { uid: "0xf", xid: `${repo}|${file}` },
        { uid: "0x1", xid: `${repo}|${renamed.id}` },
      ],
    }));

    await pruneUnreportedTests(client, mainScope(repo), [renamed]);

    expect(deletes).toEqual([]);
  });

  it("reads only the files the report carries, once each", async () => {
    const { client, queriedFiles } = graphHolding(() => ({}));

    await pruneUnreportedTests(client, mainScope(repo), [
      renamed,
      { id: "src/a.test.ts::adds", name: "adds", file },
      { id: "src/b.test.ts::t", name: "t", file: "src/b.test.ts" },
    ]);

    expect(queriedFiles).toEqual(["src/a.test.ts", "src/b.test.ts"]);
  });

  it("keeps a statement's edge to the file's own row while deleting the renamed test's", async () => {
    const { client, deletes } = graphHolding(() => ({
      chunks: [
        { uid: "0xf", xid: `${repo}|${file}`, stmts: [{ uid: "0xs" }] },
        { uid: "0x2", xid: `${repo}|src/a.test.ts::adds` },
      ],
    }));

    await pruneUnreportedTests(client, mainScope(repo), [renamed]);

    expect(deletes).toEqual(["<0x2> * * ."]);
  });

  it("writes an overlay's deletes against the Overlay's edges, under its own xids", async () => {
    const scope = overlayScope(repo, "feat/x");
    const { client, deletes } = graphHolding(() => ({
      chunks: [
        { uid: "0x1", xid: `${scope.key}|${renamed.id}` },
        { uid: "0x2", xid: `${scope.key}|src/a.test.ts::adds` },
      ],
      root: [{ uid: "0xo" }],
    }));

    await pruneUnreportedTests(client, scope, [renamed]);

    expect(deletes).toEqual([
      "<0x2> * * .",
      "<0xo> <Overlay.test_chunks> <0x2> .",
    ]);
  });
});

describe("listTestFilePaths", () => {
  it("names each file once across its TestChunks and TestSuites", async () => {
    const { client } = graphHolding(() => ({
      chunks: [{ path: "src/a.test.ts" }, { path: "src/a.test.ts" }],
      suites: [{ path: "src/a.test.ts" }, { path: "src/b.test.ts" }],
    }));

    await expect(listTestFilePaths(client, repo)).resolves.toEqual([
      "src/a.test.ts",
      "src/b.test.ts",
    ]);
  });

  it("leaves out a row that has no file path", async () => {
    const { client } = graphHolding(() => ({
      chunks: [{ path: "src/a.test.ts" }, {}],
      suites: [{}],
    }));

    await expect(listTestFilePaths(client, repo)).resolves.toEqual([
      "src/a.test.ts",
    ]);
  });
});
