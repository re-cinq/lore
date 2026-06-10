import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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

  it("report runs `run` once per file (selector = file) and fans the result to each descriptor", async () => {
    const d2 = mkdtempSync(join(tmpdir(), "exectest-fan-"));
    mkdirSync(join(d2, ".lore"), { recursive: true });
    const marker = join(d2, "runs.log");
    const manifest = {
      list: `printf '[{"id":"f.ts::a","name":"U > a","file":"f.ts","suite":["U"]},{"id":"f.ts::b","name":"U > b","file":"f.ts","suite":["U"]}]'`,
      run: `node -e "require('fs').appendFileSync('${marker}','{selector}\\n');process.stdout.write('{\\"passed\\":true,\\"covered\\":[]}')"`,
      coverage_format: "json",
    };
    writeFileSync(join(d2, ".lore", "test-commands.yml"), stringify(manifest));
    try {
      const report = await new ExecTestRunner().report(d2);
      expect(readFileSync(marker, "utf-8").trim().split("\n")).toEqual(["f.ts"]);
      expect(report).toEqual({ passed: 2, failed: 0, results: [{ passed: true, covered: [] }, { passed: true, covered: [] }] });
    } finally {
      rmSync(d2, { recursive: true, force: true });
    }
  });
});
