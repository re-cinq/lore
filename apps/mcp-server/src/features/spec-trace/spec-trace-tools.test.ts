import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executionRefusal,
  runTestsList,
  runTestsRun,
  listTestsTool,
  runTestTool,
  loadTestCommandManifest,
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
      {
        id: "t1",
        name: "first test",
        file: "src/a.test.ts",
        startLine: 1,
        endLine: 5,
      },
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
    const text = await listTestsTool(
      { LORE_DB_HOST: "10.0.0.5" },
      manifest,
      process.cwd(),
    );

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
      {
        id: "t1",
        name: "first test",
        file: "src/a.test.ts",
        startLine: 1,
        endLine: 5,
      },
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
    if (repoRoot) {
      rmSync(repoRoot, { recursive: true, force: true });
    }
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
