import { describe, it, expect } from "vitest";
import { executionRefusal, runTestsList, runTestsRun, listTestsTool } from "./spec-trace-tools.js";
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
});
