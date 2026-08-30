import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  detectTooling,
  type ValidationExec,
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

  it("scopes a lint SCRIPT to the changed files by rewriting the script, not the npm command", async () => {
    // Run b6ed264c (2026-08-30), validate:3: `npm run lint --silent` ran
    // `eslint .` over the whole monorepo and hit the 30s budget —
    // `spawnSync /bin/sh ETIMEDOUT`. Scoping strips a trailing " ." from the
    // COMMAND, and the command is `npm run lint --silent`; the "." lives
    // inside package.json. So for every repo with a lint script — which is
    // most of them — scoping has never applied at all.
    const calls: string[] = [];
    const exec: ValidationExec = async (command) => {
      calls.push(command);

      return { output: "", passed: true };
    };

    await runValidation(
      tmpDir,
      [
        {
          name: "lint",
          command: "npm run lint --silent",
          scopedCommand: "npx eslint {files}",
          timeoutMs: 5000,
        },
      ],
      ["src/a.ts", "README.md"],
      exec,
    );

    expect(calls).toEqual(['npx eslint "src/a.ts"']);
  });

  it("still scopes the bare eslint fallback command the old way", async () => {
    const calls: string[] = [];
    const exec: ValidationExec = async (command) => {
      calls.push(command);

      return { output: "", passed: true };
    };

    await runValidation(
      tmpDir,
      [{ name: "eslint", command: "npx eslint --quiet .", timeoutMs: 5000 }],
      ["src/a.ts"],
      exec,
    );

    expect(calls).toEqual(['npx eslint --quiet "src/a.ts"']);
  });

  it("runs the script unscoped when no changed files are known", async () => {
    const calls: string[] = [];
    const exec: ValidationExec = async (command) => {
      calls.push(command);

      return { output: "", passed: true };
    };

    await runValidation(
      tmpDir,
      [
        {
          name: "lint",
          command: "npm run lint --silent",
          scopedCommand: "npx eslint {files}",
          timeoutMs: 5000,
        },
      ],
      undefined,
      exec,
    );

    expect(calls).toEqual(["npm run lint --silent"]);
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

describe("detectTooling — a lint script that can be scoped", () => {
  it("derives a scoped form from an eslint script by replacing its dot with the files", () => {
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { lint: "eslint . --max-warnings 0" } }),
    );
    writeFile("node_modules/.keep", "");
    const lint = detectTooling(tmpDir).quickChecks.find(
      (c) => c.name === "lint",
    );

    expect(lint).toMatchObject({
      command: "npm run lint --silent",
      scopedCommand: "npx eslint {files} --max-warnings 0",
    });
  });

  it("derives no scoped form for a linter it does not know how to scope", () => {
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { lint: "biome check ." } }),
    );
    writeFile("node_modules/.keep", "");
    const lint = detectTooling(tmpDir).quickChecks.find(
      (c) => c.name === "lint",
    );

    expect(lint?.scopedCommand).toBeUndefined();
  });

  it("replaces only the bare tree token, leaving dotted flags and paths alone", () => {
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { lint: "eslint . --ext .ts ./extra" } }),
    );
    writeFile("node_modules/.keep", "");

    expect(
      detectTooling(tmpDir).quickChecks.find((c) => c.name === "lint"),
    ).toMatchObject({ scopedCommand: "npx eslint {files} --ext .ts ./extra" });
  });

  it("leaves an env-prefixed script unscoped rather than re-implementing the shell", () => {
    writeFile(
      "package.json",
      JSON.stringify({
        scripts: { lint: "NODE_OPTIONS=--max-old-space-size=4096 eslint ." },
      }),
    );
    writeFile("node_modules/.keep", "");

    expect(
      detectTooling(tmpDir).quickChecks.find((c) => c.name === "lint")
        ?.scopedCommand,
    ).toBeUndefined();
  });

  it("never scopes a lint script it could not rewrite, even with changed files", async () => {
    // The regex path used to claim the `lint` step too; it could only ever
    // have matched a command ending in " .", which `npm run lint` never does.
    // Dropping it makes "unscoped" the explicit outcome, not an accident.
    const calls: string[] = [];
    const exec: ValidationExec = async (command) => {
      calls.push(command);

      return { output: "", passed: true };
    };

    await runValidation(
      tmpDir,
      [{ name: "lint", command: "npm run lint --silent", timeoutMs: 5000 }],
      ["src/a.ts"],
      exec,
    );

    expect(calls).toEqual(["npm run lint --silent"]);
  });

  it("gives lint a budget a whole monorepo can finish in, since scoping is best-effort", () => {
    // 30s was calibrated for the scoped run that never happened. Unscoped
    // `eslint .` on this repo takes minutes; a diff that cannot be derived
    // (no origin/HEAD) still has to finish.
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { lint: "eslint ." } }),
    );
    writeFile("node_modules/.keep", "");

    expect(
      detectTooling(tmpDir).quickChecks.find((c) => c.name === "lint"),
    ).toMatchObject({ timeoutMs: 120_000 });
  });
});

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

  it("runs the build BEFORE lint on a fresh-clone workspaces repo", () => {
    // Run b219a4f1 (2026-08-30): `npm ci` restored node_modules and eslint then
    // died on `cannot import @re-cinq/lore-shared/spec-status.js` — this repo's
    // own ESLint plugin imports a workspace package's COMPILED output, which an
    // install does not produce. Both implement nodes succeeded and both
    // validate nodes failed identically, so the retry bought a second
    // 40-minute implementation against a fault no implementation could fix.
    writeFile(
      "package.json",
      JSON.stringify({
        workspaces: ["libs/*"],
        scripts: { lint: "eslint .", build: "tsc -b" },
      }),
    );
    writeFile("package-lock.json", "{}");
    const tooling = detectTooling(tmpDir);

    expect(tooling.quickChecks.map((c) => c.name)).toEqual([
      "install",
      "build",
      "lint",
    ]);
    expect(tooling.fullChecks.map((c) => c.name).slice(0, 3)).toEqual([
      "install",
      "build",
      "lint",
    ]);
  });

  it("moves that build rather than adding a second one", () => {
    // One command, one step. A `workspace-build` beside the existing `build`
    // would compile the repo twice on every fresh clone.
    writeFile(
      "package.json",
      JSON.stringify({
        workspaces: ["libs/*"],
        scripts: { lint: "eslint .", build: "tsc -b" },
      }),
    );
    writeFile("package-lock.json", "{}");
    const names = detectTooling(tmpDir).quickChecks.map((c) => c.name);

    expect(names.filter((n) => n === "build")).toHaveLength(1);
  });

  it("gives the hoisted build a cold-clone budget, not the warm 60s one", () => {
    writeFile(
      "package.json",
      JSON.stringify({
        workspaces: ["libs/*"],
        scripts: { lint: "eslint .", build: "tsc -b" },
      }),
    );
    writeFile("package-lock.json", "{}");
    const build = detectTooling(tmpDir).quickChecks.find(
      (c) => c.name === "build",
    );

    expect(build).toMatchObject({
      command: "npm run build --silent",
      timeoutMs: 300_000,
    });
  });

  it("leaves the build after lint for a repo that declares no workspaces", () => {
    // A single-package repo's lint reads source, so compiling first buys
    // nothing and costs every validate the time.
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { lint: "eslint .", build: "tsc -b" } }),
    );
    writeFile("package-lock.json", "{}");

    expect(detectTooling(tmpDir).quickChecks.map((c) => c.name)).toEqual([
      "install",
      "lint",
      "build",
    ]);
  });

  it("hoists for Yarn's object spelling of workspaces too", () => {
    // `{ packages: [...] }` is Yarn's form, and plenty of npm-installed repos
    // still carry it. The intent of the guard is "is this a monorepo", not
    // "which tool wrote the field".
    writeFile(
      "package.json",
      JSON.stringify({
        workspaces: { packages: ["libs/*"] },
        scripts: { lint: "eslint .", build: "tsc -b" },
      }),
    );
    writeFile("package-lock.json", "{}");

    expect(detectTooling(tmpDir).quickChecks.map((c) => c.name)).toEqual([
      "install",
      "build",
      "lint",
    ]);
  });

  it("hoists nothing for a workspaces value that is neither shape", () => {
    writeFile(
      "package.json",
      JSON.stringify({
        workspaces: "libs/*",
        scripts: { lint: "eslint .", build: "tsc -b" },
      }),
    );
    writeFile("package-lock.json", "{}");

    expect(detectTooling(tmpDir).quickChecks.map((c) => c.name)).toEqual([
      "install",
      "lint",
      "build",
    ]);
  });

  it("hoists nothing when the workspaces repo has no build script", () => {
    writeFile(
      "package.json",
      JSON.stringify({ workspaces: ["libs/*"], scripts: { lint: "eslint ." } }),
    );
    writeFile("package-lock.json", "{}");

    expect(detectTooling(tmpDir).quickChecks.map((c) => c.name)).toEqual([
      "install",
      "lint",
    ]);
  });

  it("hoists nothing when node_modules is already there, like the install", () => {
    writeFile(
      "package.json",
      JSON.stringify({
        workspaces: ["libs/*"],
        scripts: { lint: "eslint .", build: "tsc -b" },
      }),
    );
    writeFile("node_modules/.keep", "");

    expect(detectTooling(tmpDir).quickChecks.map((c) => c.name)).toEqual([
      "lint",
      "build",
    ]);
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
