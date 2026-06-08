import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { ExecTestRunner } from "./test-runner-exec.js";

/**
 * ExecTestRunner against a REAL .lore/test-commands.yml whose list/run are
 * trivial shell commands emitting the contract JSON. Integration (real exec),
 * no mocks. Skips on Windows where the shell differs.
 */

describe.skipIf(process.platform === "win32")("ExecTestRunner (live shell)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "exectest-"));
    mkdirSync(join(dir, ".lore"), { recursive: true });
    const manifest = {
      list: `printf '[{"id":"t1","name":"adds","file":"f.ts","startLine":1,"endLine":2}]'`,
      run: `: {selector}; printf '{"passed":true,"covered":[]}'`,
      coverage_format: "json",
    };
    writeFileSync(join(dir, ".lore", "test-commands.yml"), stringify(manifest));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("lists the descriptors emitted by the manifest list command", async () => {
    const runner = new ExecTestRunner();

    expect(await runner.listTests(dir)).toEqual([
      { id: "t1", name: "adds", file: "f.ts", startLine: 1, endLine: 2 },
    ]);
  });

  it("runs a single test and aggregates the report", async () => {
    const runner = new ExecTestRunner();

    expect(await runner.runTest(dir, "t1")).toEqual({ passed: true, covered: [] });
    expect(await runner.report(dir)).toEqual({ passed: 1, failed: 0, results: [{ passed: true, covered: [] }] });
  });
});
