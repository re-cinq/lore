import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executionRefusal,
  runTestsList,
  runTestsRun,
  listTestsTool,
  runTestTool,
  loadTestCommandManifest,
  buildTestReport,
  stripPathPrefix,
} from "./spec-trace-tools.js";
import type { TestCommandManifest } from "@re-cinq/lore-shared";

describe("executionRefusal", () => {
  it("returns a non-empty string when LORE_DB_HOST is set", () => {
    const refusal = executionRefusal({ LORE_DB_HOST: "10.0.0.5" });
    expect(typeof refusal).toBe("string");
    expect(refusal).toBeTruthy();
  });

  it("returns null when LORE_DB_HOST is unset", () => {
    expect(executionRefusal({})).toBeNull();
  });

  it("names the remedy of running in CI or locally when refusing", () => {
    expect(executionRefusal({ LORE_DB_HOST: "10.0.0.5" })).toMatch(/CI|local/i);
  });
});

describe("runTestsList", () => {
  it("returns parsed descriptors from the list command stdout", async () => {
    const descriptors = await runTestsList(
      `printf '[{"id":"t1","name":"first test","file":"src/a.test.ts","startLine":1,"endLine":5}]'`,
      process.cwd(),
    );
    expect(descriptors).toEqual([
      { id: "t1", name: "first test", file: "src/a.test.ts", startLine: 1, endLine: 5 },
    ]);
  });

  it("rejects when the command outlives the timeout", async () => {
    await expect(
      runTestsList(`sleep 1 && printf '[]'`, process.cwd(), 50),
    ).rejects.toThrow();
  });

  it("rejects naming the list command when stdout is not JSON", async () => {
    await expect(
      runTestsList(`printf 'not json'`, process.cwd()),
    ).rejects.toThrow(/tests\.list|list command/i);
  });
});

describe("listTestsTool", () => {
  it("returns the CI-or-local refusal without running the list command on the cluster", async () => {
    const manifest: TestCommandManifest = {
      list: "printf 'SHOULD_NOT_RUN'",
      run: "x {selector}",
      coverage_format: "json",
      cwd: ".",
      path_prefix_strip: "",
    };
    const text = await listTestsTool({ LORE_DB_HOST: "10.0.0.5" }, manifest, process.cwd());
    expect(text).toMatch(/CI|local/i);
  });

  it("reports no manifest declared when the manifest is null on a local sandbox", async () => {
    const text = await listTestsTool({}, null, process.cwd());
    expect(text).toMatch(/manifest/i);
  });

  it("runs the list command and returns the descriptors on a local sandbox", async () => {
    const manifest: TestCommandManifest = {
      list: `printf '[{"id":"t1","name":"first test","file":"src/a.test.ts","startLine":1,"endLine":5}]'`,
      run: "x {selector}",
      coverage_format: "json",
      cwd: ".",
      path_prefix_strip: "",
    };
    const text = await listTestsTool({}, manifest, process.cwd());
    expect(JSON.parse(text)).toEqual([
      { id: "t1", name: "first test", file: "src/a.test.ts", startLine: 1, endLine: 5 },
    ]);
  });
});

describe("runTestTool", () => {
  it("returns the CI-or-local refusal without running the run command on the cluster", async () => {
    const manifest: TestCommandManifest = {
      list: "x",
      run: "printf 'SHOULD_NOT_RUN'",
      coverage_format: "json",
      cwd: ".",
      path_prefix_strip: "",
    };
    const text = await runTestTool(
      { LORE_DB_HOST: "10.0.0.5" },
      manifest,
      "src/a.test.ts::my test",
      process.cwd(),
    );
    expect(text).toMatch(/CI|local/i);
  });
});

describe("loadTestCommandManifest", () => {
  let repoRoot: string;

  afterEach(() => {
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
  });

  it("returns the manifest parsed from .lore/test-commands.yml", () => {
    repoRoot = mkdtempSync(join(tmpdir(), "lore-"));
    mkdirSync(join(repoRoot, ".lore"));
    writeFileSync(
      join(repoRoot, ".lore", "test-commands.yml"),
      'list: "npm run -s test:list-json"\n' +
        'run: "npm run -s test:run-json -- {selector}"\n' +
        'coverage_format: "json"\n',
    );

    expect(loadTestCommandManifest(repoRoot)).toMatchObject({
      list: "npm run -s test:list-json",
      run: "npm run -s test:run-json -- {selector}",
      coverage_format: "json",
    });
  });

  it("returns null when no .lore/test-commands.yml exists", () => {
    repoRoot = mkdtempSync(join(tmpdir(), "lore-"));
    expect(loadTestCommandManifest(repoRoot)).toBeNull();
  });
});

describe("buildTestReport", () => {
  it("assembles commit, branch, descriptors, and per-descriptor results", async () => {
    const manifest: TestCommandManifest = {
      list: `printf '[{"id":"t1","name":"first","file":"a.test.ts","startLine":1,"endLine":2}]'`,
      run: `printf '{"passed":true,"covered":[{"file":"a.ts","startLine":3,"endLine":4}]}'`,
      coverage_format: "json",
      cwd: ".",
      path_prefix_strip: "",
    };

    const report = await buildTestReport({}, manifest, process.cwd(), {
      commit: "c1",
      branch: "main",
    });

    expect(report).toEqual({
      commit: "c1",
      branch: "main",
      tests: [{ id: "t1", name: "first", file: "a.test.ts", startLine: 1, endLine: 2 }],
      results: [{ id: "t1", passed: true, covered: [{ file: "a.ts", startLine: 3, endLine: 4 }] }],
    });
  });

  it("runs `run` once per file and fans the result to every descriptor sharing that file", async () => {
    const root = mkdtempSync(join(tmpdir(), "lore-fan-"));
    const marker = join(root, "runs.log");
    // `run` appends the selector it was given, then prints the selector as the covered file.
    const run = `node -e "require('fs').appendFileSync('${marker}','{selector}\\n');process.stdout.write(JSON.stringify({passed:true,covered:[{file:'{selector}',startLine:1,endLine:1}]}))"`;
    const manifest: TestCommandManifest = {
      list: `printf '[{"id":"a.test.ts::x","name":"A > x","file":"a.test.ts","suite":["A"]},{"id":"a.test.ts::y","name":"A > y","file":"a.test.ts","suite":["A"]},{"id":"b.test.ts::z","name":"B > z","file":"b.test.ts","suite":["B"]}]'`,
      run,
      coverage_format: "json",
      cwd: ".",
      path_prefix_strip: "",
    };

    try {
      const report = await buildTestReport({}, manifest, process.cwd(), { commit: "c1", branch: "main" });

      // 3 descriptors across 2 files → `run` invoked exactly twice (once per file).
      expect(readFileSync(marker, "utf-8").trim().split("\n").sort()).toEqual(["a.test.ts", "b.test.ts"]);
      // Every descriptor gets a result; covered.file equals the FILE selector, not the per-it id.
      expect(report.results).toEqual([
        { id: "a.test.ts::x", passed: true, covered: [{ file: "a.test.ts", startLine: 1, endLine: 1 }] },
        { id: "a.test.ts::y", passed: true, covered: [{ file: "a.test.ts", startLine: 1, endLine: 1 }] },
        { id: "b.test.ts::z", passed: true, covered: [{ file: "b.test.ts", startLine: 1, endLine: 1 }] },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("strips path_prefix_strip from descriptor and covered-chunk file paths", async () => {
    const manifest: TestCommandManifest = {
      list: `printf '[{"id":"t1","name":"a","file":"pkg/src/a.test.ts"}]'`,
      run: `printf '{"passed":true,"covered":[{"file":"pkg/src/a.ts","startLine":1,"endLine":1}]}'`,
      coverage_format: "json",
      cwd: ".",
      path_prefix_strip: "pkg/",
    };

    const report = await buildTestReport({}, manifest, process.cwd(), {
      commit: "c1",
      branch: "main",
    });

    expect(report).toEqual({
      commit: "c1",
      branch: "main",
      tests: [{ id: "t1", name: "a", file: "src/a.test.ts" }],
      results: [
        { id: "t1", passed: true, covered: [{ file: "src/a.ts", startLine: 1, endLine: 1 }] },
      ],
    });
  });

  it("skips a descriptor whose run command exits non-zero and resolves with empty results", async () => {
    const manifest: TestCommandManifest = {
      list: `printf '[{"id":"t1","name":"a","file":"a.ts"}]'`,
      run: "sh -c 'exit 1'",
      coverage_format: "json",
      cwd: ".",
      path_prefix_strip: "",
    };

    const report = await buildTestReport({}, manifest, process.cwd(), {
      commit: "c1",
      branch: "main",
    });

    expect(report).toEqual({
      commit: "c1",
      branch: "main",
      tests: [{ id: "t1", name: "a", file: "a.ts" }],
      results: [],
    });
  });

  it("runs list and run commands in manifest.cwd resolved under the passed cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "lore-"));
    mkdirSync(join(root, "pkg"));
    writeFileSync(join(root, "pkg", "list.json"), '[{"id":"t1","name":"a","file":"a.ts"}]');
    writeFileSync(join(root, "pkg", "run.json"), '{"passed":true,"covered":[]}');

    const manifest: TestCommandManifest = {
      list: "cat list.json",
      run: "cat run.json",
      coverage_format: "json",
      cwd: "pkg",
      path_prefix_strip: "",
    };

    try {
      const report = await buildTestReport({}, manifest, root, {
        commit: "c1",
        branch: "main",
      });

      expect(report).toEqual({
        commit: "c1",
        branch: "main",
        tests: [{ id: "t1", name: "a", file: "a.ts" }],
        results: [{ id: "t1", passed: true, covered: [] }],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to run manifest commands on the shared cluster when LORE_DB_HOST is set", async () => {
    const manifest: TestCommandManifest = {
      list: "printf 'SHOULD_NOT_RUN'",
      run: "printf 'SHOULD_NOT_RUN'",
      coverage_format: "json",
      cwd: ".",
      path_prefix_strip: "",
    };

    await expect(
      buildTestReport({ LORE_DB_HOST: "10.0.0.5" }, manifest, process.cwd(), {
        commit: "c1",
        branch: "main",
      }),
    ).rejects.toThrow(/CI|local/i);
  });
});

describe("runTestsRun", () => {
  it("substitutes the selector into the run command before executing", async () => {
    const result = await runTestsRun(
      `printf '{"passed":true,"covered":[{"file":"{selector}","startLine":1,"endLine":1}]}'`,
      "src/a.test.ts::my test",
      process.cwd(),
    );
    expect(result).toEqual({
      passed: true,
      covered: [{ file: "src/a.test.ts::my test", startLine: 1, endLine: 1 }],
    });
  });

  it("rejects when the command outlives the timeout", async () => {
    await expect(
      runTestsRun(
        `sleep 1 && printf '{"passed":true,"covered":[]}'`,
        "x",
        process.cwd(),
        50,
      ),
    ).rejects.toThrow();
  });

  it("rejects naming the run command when output is not JSON", async () => {
    await expect(
      runTestsRun("printf 'not json'", "some-selector", process.cwd()),
    ).rejects.toThrow(/tests\.run|run command/i);
  });
});

describe("stripPathPrefix", () => {
  it("removes a matching leading prefix", () => {
    expect(stripPathPrefix("services/api/src/a.ts", "services/api/")).toEqual(
      "src/a.ts",
    );
  });
});
