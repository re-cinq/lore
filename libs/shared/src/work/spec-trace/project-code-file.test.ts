import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as dgraph from "dgraph-js-http";
import { findRepoRoot } from "../../lib/repo-root.js";
import { dgraphReachable } from "../../lib/dgraph-test-gate.js";
import { makeDeleteRepoNodes } from "../../outbound/spec-trace/test-helpers/delete-repo-nodes.js";
import { callersOf } from "../../outbound/spec-trace/code-callers.js";
import {
  deleteCodeFile,
  listCodeFilePaths,
  projectCodeFile,
} from "./project-code-file.js";

const DGRAPH_HTTP = process.env.DGRAPH_HTTP ?? "http://localhost:8081";
const APPLIER = join(
  findRepoRoot(),
  "scripts",
  "infra",
  "setup-spec-trace-schema.sh",
);

const TRANSITION = [
  "export function nextTransition(state: number) {",
  "  return state + 1;",
  "}",
].join("\n");

const RUNNER = [
  'import { nextTransition } from "./transition.js";',
  "export function advance(state: number) {",
  "  return nextTransition(state);",
  "}",
].join("\n");

const reachable = await dgraphReachable();

describe.skipIf(!reachable)("projectCodeFile (live Dgraph)", () => {
  const client = new dgraph.DgraphClient(
    new dgraph.DgraphClientStub(DGRAPH_HTTP),
  );
  const deleteRepoNodes = makeDeleteRepoNodes(client, [
    { alias: "chunks", type: "CodeChunk" },
  ]);
  let repo = "";

  beforeAll(() => {
    execFileSync("bash", [APPLIER], {
      env: { ...process.env, DGRAPH_HTTP },
      stdio: "pipe",
    });
  });

  afterEach(async () => {
    await deleteRepoNodes(repo);
  });

  const project = (filePath: string, content: string) =>
    projectCodeFile({ repo, filePath, content }, client);

  const projectBoth = async () => {
    repo = `test-code/${randomUUID()}`;
    await project("src/runner.ts", RUNNER);
    await project("src/transition.ts", TRANSITION);
  };

  it("answers advance in src/runner.ts as the caller of nextTransition", async () => {
    await projectBoth();

    expect(await callersOf(client, repo, "nextTransition")).toEqual([
      { filePath: "src/runner.ts", symbol: "advance", startLine: 2 },
    ]);
  });

  it("answers nextTransition in src/transition.ts as the callee of advance", async () => {
    await projectBoth();

    expect(await callersOf(client, repo, "advance", "callees")).toEqual([
      { filePath: "src/transition.ts", symbol: "nextTransition", startLine: 1 },
    ]);
  });

  it("reports projected false when src/runner.ts is projected again unchanged", async () => {
    await projectBoth();

    expect(await project("src/runner.ts", RUNNER)).toEqual({
      projected: false,
    });
  });

  it("answers no callers once advance stops calling nextTransition", async () => {
    await projectBoth();
    await project(
      "src/runner.ts",
      "export function advance(state: number) {\n  return state;\n}",
    );

    expect(await callersOf(client, repo, "nextTransition")).toEqual([]);
  });

  it("removes the reference edges of src/runner.ts when the file is deleted", async () => {
    await projectBoth();
    await deleteCodeFile(client, repo, "src/runner.ts");

    expect(await callersOf(client, repo, "nextTransition")).toEqual([]);
  });

  it("answers advance again when src/transition.ts is deleted and projected back", async () => {
    await projectBoth();
    await deleteCodeFile(client, repo, "src/transition.ts");
    await project("src/transition.ts", TRANSITION);

    expect(await callersOf(client, repo, "nextTransition")).toEqual([
      { filePath: "src/runner.ts", symbol: "advance", startLine: 2 },
    ]);
  });

  it("reports projected false for a src/generated.ts over 256000 characters", async () => {
    repo = `test-code/${randomUUID()}`;
    const generated = "export function g() {}\n".repeat(12_000);

    expect(await project("src/generated.ts", generated)).toEqual({
      projected: false,
    });
  });

  it("lists src/runner.ts and src/transition.ts as the projected code files", async () => {
    await projectBoth();

    expect((await listCodeFilePaths(client, repo)).sort()).toEqual([
      "src/runner.ts",
      "src/transition.ts",
    ]);
  });
});
