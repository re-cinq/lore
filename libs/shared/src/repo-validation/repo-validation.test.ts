import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  detectTooling,
  runValidation,
  formatValidationOutput,
} from "./repo-validation.js";

// ---------------------------------------------------------------------------
// Helpers — create temp directories with config files for detection tests
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lore-validation-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): void {
  const filePath = path.join(tmpDir, name);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// ---------------------------------------------------------------------------
// detectTooling
// ---------------------------------------------------------------------------

describe("detectTooling", () => {
  it("detects Node repo with lint and typecheck scripts", async () => {
    writeFile(
      "package.json",
      JSON.stringify({
        scripts: {
          lint: "eslint .",
          typecheck: "tsc --noEmit",
          test: "vitest run",
        },
      }),
    );
    const tooling = detectTooling(tmpDir);

    expect(tooling.language).toBe("node");
    expect(tooling.quickChecks.map((s) => s.name)).toContain("lint");
    expect(tooling.quickChecks.map((s) => s.name)).toContain("typecheck");
    expect(tooling.fullChecks.map((s) => s.name)).toContain("test");
  });

  it("detects Node repo with eslint config but no lint script", async () => {
    writeFile("package.json", JSON.stringify({ scripts: {} }));
    writeFile("eslint.config.mjs", "export default {};");
    const tooling = detectTooling(tmpDir);

    expect(tooling.language).toBe("node");
    expect(tooling.quickChecks.map((s) => s.name)).toContain("eslint");
  });

  it("detects Node repo with tsconfig but no typecheck script", async () => {
    writeFile("package.json", JSON.stringify({ scripts: {} }));
    writeFile("tsconfig.json", "{}");
    const tooling = detectTooling(tmpDir);

    expect(tooling.language).toBe("node");
    expect(tooling.quickChecks.map((s) => s.name)).toContain("tsc");
  });

  it("detects vitest and adds --run flag", async () => {
    writeFile(
      "package.json",
      JSON.stringify({
        scripts: { test: "vitest run" },
      }),
    );
    const tooling = detectTooling(tmpDir);
    const testStep = tooling.fullChecks.find((s) => s.name === "test");

    expect(testStep?.command).toContain("--run");
  });

  it("detects jest and adds --bail flag", async () => {
    writeFile(
      "package.json",
      JSON.stringify({
        scripts: { test: "jest" },
      }),
    );
    const tooling = detectTooling(tmpDir);
    const testStep = tooling.fullChecks.find((s) => s.name === "test");

    expect(testStep?.command).toContain("--bail");
  });

  it("detects Go repo", async () => {
    writeFile("go.mod", "module example.com/foo\n\ngo 1.22\n");
    const tooling = detectTooling(tmpDir);

    expect(tooling.language).toBe("go");
    expect(tooling.quickChecks.map((s) => s.name)).toEqual([
      "go-vet",
      "go-build",
    ]);
    expect(tooling.fullChecks.map((s) => s.name)).toContain("go-test");
  });

  it("detects Python repo with ruff and pytest", async () => {
    writeFile(
      "pyproject.toml",
      `
[tool.ruff]
line-length = 120

[tool.pytest]
testpaths = ["tests"]
`,
    );
    const tooling = detectTooling(tmpDir);

    expect(tooling.language).toBe("python");
    expect(tooling.quickChecks.map((s) => s.name)).toContain("ruff");
    expect(tooling.fullChecks.map((s) => s.name)).toContain("pytest");
  });

  it("detects Rust repo", async () => {
    writeFile("Cargo.toml", '[package]\nname = "foo"\nversion = "0.1.0"\n');
    const tooling = detectTooling(tmpDir);

    expect(tooling.language).toBe("rust");
    expect(tooling.quickChecks.map((s) => s.name)).toEqual([
      "cargo-check",
      "cargo-clippy",
    ]);
  });

  it("returns unknown for empty directory", async () => {
    const tooling = detectTooling(tmpDir);

    expect(tooling.language).toBe("unknown");
    expect(tooling.quickChecks).toEqual([]);
    expect(tooling.fullChecks).toEqual([]);
  });

  it("prefers Node over other languages when package.json exists", async () => {
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { lint: "eslint ." } }),
    );
    writeFile("go.mod", "module example.com/foo\n");
    const tooling = detectTooling(tmpDir);

    expect(tooling.language).toBe("node");
  });
});

// ---------------------------------------------------------------------------
// runValidation
// ---------------------------------------------------------------------------

describe("runValidation", () => {
  it("returns passed=true for successful commands", async () => {
    const result = await runValidation(tmpDir, [
      { name: "echo-test", command: "echo hello", timeoutMs: 5000 },
    ]);

    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].passed).toBe(true);
    expect(result.steps[0].output).toContain("hello");
  });

  it("returns passed=false for failing commands", async () => {
    const result = await runValidation(tmpDir, [
      { name: "fail-test", command: "exit 1", timeoutMs: 5000 },
    ]);

    expect(result.passed).toBe(false);
    expect(result.steps[0].passed).toBe(false);
  });

  it("runs all steps even if one fails", async () => {
    const result = await runValidation(tmpDir, [
      { name: "fail", command: "exit 1", timeoutMs: 5000 },
      { name: "pass", command: "echo ok", timeoutMs: 5000 },
    ]);

    expect(result.passed).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].passed).toBe(false);
    expect(result.steps[1].passed).toBe(true);
  });

  it("returns passed=true with empty steps", async () => {
    const result = await runValidation(tmpDir, []);

    expect(result.passed).toBe(true);
    expect(result.steps).toEqual([]);
  });

  it("skips lint steps when no matching changed files", async () => {
    const result = await runValidation(
      tmpDir,
      [{ name: "eslint", command: "echo should-not-run", timeoutMs: 5000 }],
      ["README.md"],
    ); // .md files don't match eslint extensions

    expect(result.passed).toBe(true);
    expect(result.steps[0].output).toContain("skipped");
  });

  it("tracks duration per step", async () => {
    const result = await runValidation(tmpDir, [
      { name: "quick", command: "echo fast", timeoutMs: 5000 },
    ]);

    expect(result.steps[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(result.steps[0].durationMs).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------------------
// formatValidationOutput
// ---------------------------------------------------------------------------

describe("formatValidationOutput", () => {
  it("formats passing results", async () => {
    const output = formatValidationOutput({
      passed: true,
      steps: [{ name: "lint", passed: true, output: "ok", durationMs: 100 }],
    });

    expect(output).toContain("[PASS] lint");
  });

  it("formats failing results with output", async () => {
    const output = formatValidationOutput({
      passed: false,
      steps: [
        {
          name: "tsc",
          passed: false,
          output: "error TS1234: bad types",
          durationMs: 500,
        },
      ],
    });

    expect(output).toContain("[FAIL] tsc");
    expect(output).toContain("error TS1234");
  });
});

// ---------------------------------------------------------------------------
// Dependency install — a fresh clone must be validatable
// ---------------------------------------------------------------------------

describe("detectTooling — dependency install on a fresh clone", () => {
  it("prepends npm ci when a lockfile exists and node_modules does not", () => {
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { lint: "eslint ." } }),
    );
    writeFile("package-lock.json", "{}");
    const tooling = detectTooling(tmpDir);

    expect(tooling.quickChecks[0]).toMatchObject({
      name: "install",
      command: "npm ci --no-audit --no-fund",
    });
    expect(tooling.fullChecks[0]?.name).toBe("install");
  });

  it("falls back to npm install when there is no lockfile", () => {
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { lint: "eslint ." } }),
    );
    const tooling = detectTooling(tmpDir);

    expect(tooling.quickChecks[0]).toMatchObject({
      name: "install",
      command: "npm install --no-audit --no-fund",
    });
    expect(tooling.fullChecks[0]?.name).toBe("install");
  });

  it("adds no install step when node_modules is already present", () => {
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { lint: "eslint ." } }),
    );
    writeFile("node_modules/.keep", "");
    const tooling = detectTooling(tmpDir);

    expect(tooling.quickChecks.map((s) => s.name)).not.toContain("install");
  });

  it("adds no install step when the repo has nothing to check", () => {
    writeFile("package.json", JSON.stringify({ scripts: {} }));
    const tooling = detectTooling(tmpDir);

    expect(tooling.quickChecks).toEqual([]);
    expect(tooling.fullChecks).toEqual([]);
  });
});
