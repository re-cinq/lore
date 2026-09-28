import { describe, it, expect } from "vitest";
import { join, resolve } from "node:path";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const GUARD = resolve(
  import.meta.dirname,
  "../../agent-skills/skills/lore-context/guard-tests.sh",
);

function guard(command: string, policy?: string) {
  const result = spawnSync("sh", [GUARD], {
    input: JSON.stringify({
      cwd: "/workspace/target",
      tool_name: "Bash",
      tool_input: { command },
    }),
    env: {
      PATH: process.env.PATH,
      ...(policy ? { LORE_TEST_POLICY: policy } : {}),
    },
  });

  return { code: result.status, reason: result.stderr.toString().trim() };
}

const blocked = (command: string, policy?: string) =>
  guard(command, policy).code === 2;

function geminiDecision(command: string, policy: string): string | null {
  const settings = JSON.parse(
    readFileSync(
      resolve(GUARD, "../../../hooks/gemini/.gemini/settings.json"),
      "utf8",
    ),
  ) as { hooks: { BeforeTool: Array<{ hooks: Array<{ command: string }> }> } };
  const home = mkdtempSync(join(tmpdir(), "lore-gemini-hook-"));
  const staged = join(home, ".claude/skills/lore-context");

  mkdirSync(staged, { recursive: true });
  copyFileSync(GUARD, join(staged, "guard-tests.sh"));
  const result = spawnSync(
    "sh",
    ["-c", settings.hooks.BeforeTool[0].hooks[0].command],
    {
      input: JSON.stringify({
        cwd: "/workspace/target",
        tool_name: "run_shell_command",
        tool_input: { command },
      }),
      env: { PATH: process.env.PATH, HOME: home, LORE_TEST_POLICY: policy },
    },
  );
  const out = result.stdout.toString().trim();

  return out === "" ? null : (JSON.parse(out) as { reason: string }).reason;
}

describe("guard-tests hook", () => {
  it("is wired as the Bash PreToolUse hook in the settings every pod fetches, at the path the lore-context tarball unpacks to", () => {
    const settings = JSON.parse(
      readFileSync(
        resolve(GUARD, "../../../hooks/claude/.claude/settings.json"),
        "utf8",
      ),
    ) as {
      hooks: {
        PreToolUse: Array<{
          matcher: string;
          hooks: Array<{ type: string; command: string }>;
        }>;
      };
    };

    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: expect.stringContaining(
              "$HOME/.claude/skills/lore-context/guard-tests.sh",
            ),
          },
        ],
      },
    ]);
  });

  it("refuses a bare suite run with the reason the agent needs", () => {
    expect(guard("npm test")).toEqual({
      code: 2,
      reason: expect.stringMatching(
        /^\[lore\] blocked: .*full suite.*npx vitest run/,
      ),
    });
  });

  it("refuses every unscoped runner spelling under the default policy", () => {
    const unscoped = [
      "npm run test:coverage",
      "npx vitest run --coverage",
      "yarn test",
      "npx jest",
      "go test ./...",
      "pytest",
      "cd /workspace/target && npm test",
      "git status && npx vitest run",
      "npm t",
      "npm run-script test",
      "make test",
      "node --test",
      "npx turbo run test",
      "npm\ttest",
    ];

    expect(unscoped.filter((c) => !blocked(c))).toEqual([]);
  });

  it("sees through a shell wrapper, a quoted command and a direct node_modules binary", () => {
    const wrapped = [
      'sh -c "npm test"',
      "bash -c 'npx vitest run'",
      'eval "npm test"',
      "node_modules/.bin/vitest run",
      "./node_modules/.bin/jest",
      "node node_modules/vitest/vitest.mjs run",
      "CI=1 timeout 600 npm test",
      "echo npm test | sh",
    ];

    expect(wrapped.filter((c) => !blocked(c))).toEqual([]);
  });

  it("refuses a runner whose scope is only vouched for by a comment, a neighbouring command, an --exclude or a watch flag", () => {
    const vouched = [
      "npx vitest run # foo.test.ts",
      "npx vitest run; ls x.test.ts",
      "cd apps && cd .. && npm test",
      "cd apps/floor && cd - && npm test",
      "cd apps/floor; cd /workspace/target; npm test",
      "npx vitest run --exclude foo.test.ts",
      "npx vitest run -w --coverage",
    ];

    expect(vouched.filter((c) => !blocked(c))).toEqual([]);
  });

  it("lets a runner through when it names files, a workspace, a Go package or a subdirectory", () => {
    const scoped = [
      "npx vitest run apps/floor/src/work/merge/auto-merge.test.ts",
      'npx vitest run src/foo.test.ts -t "merges when green"',
      "npm test -w @re-cinq/lore-floor",
      "cd apps/floor && npx vitest run --coverage",
      "go test ./apps/lore-code-trace",
      "pytest tests/test_coverage.py::test_lcov",
      "cd /workspace/target/apps/floor && npx vitest run --coverage",
      'cd "apps/floor" && npm test',
      "cd apps/floor && npm ci && npm test",
      "pytest tests/",
      "go test ./apps/...",
      "cargo test -p lore-code-trace",
      "npx vitest run src/foo",
      "npm test --workspace=apps/floor",
      "npm test --prefix apps/floor",
      'sh -c "npx vitest run src/x.test.ts"',
      "npx vitest run src/x.test.ts # the one I wrote",
    ];

    expect(scoped.filter((c) => blocked(c))).toEqual([]);
  });

  it("ignores commands that are not test runners, installs included, under the default policy", () => {
    const ordinary = [
      "npm ci",
      "git log --oneline -5",
      "ls -la",
      "cat package.json",
      'grep -rn "npm test" .github/',
      "git log --grep vitest",
      "cat vitest.config.ts",
      "ls *.ts",
    ];

    expect(ordinary.filter((c) => blocked(c))).toEqual([]);
  });

  it("refuses named tests, installs and builds alike under policy none", () => {
    const forbidden = [
      "npx vitest run src/foo.test.ts",
      "npm ci",
      "npm run build",
      "npx tsc --noEmit",
      "yarn",
      "uv sync",
      'sh -c "npm ci"',
      "node_modules/.bin/tsc",
      "timeout 60 make",
      "git diff && npm ci",
    ];
    const reading = [
      "git diff main...HEAD",
      "echo make",
      "grep -n tsc package.json",
      'grep -rn "npm ci" .github',
      "cat Makefile",
    ];

    expect(forbidden.filter((c) => !blocked(c, "none"))).toEqual([]);
    expect(reading.filter((c) => blocked(c, "none"))).toEqual([]);
  });

  it("stands down under policy any and on an event with no command", () => {
    const noCommand = spawnSync("sh", [GUARD], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: {} }),
      env: { PATH: process.env.PATH },
    });

    expect(blocked("npm test", "any")).toBe(false);
    expect(noCommand.status).toBe(0);
  });

  it("counts a dot-relative subdirectory as scoped but never the repo root, whether spelled `.`, `./` or absolute", () => {
    const scoped = [
      "cd ./apps/floor && npx vitest run --coverage",
      "cd ../floor && npx vitest run",
    ];
    const root = [
      "cd . && npm test",
      "cd ./ && npm test",
      "cd /workspace/target && npm test",
    ];

    expect(scoped.filter((c) => blocked(c))).toEqual([]);
    expect(root.filter((c) => !blocked(c))).toEqual([]);
  });

  it("blocks every Bash call when the recipe declares a policy but the guard script is gone, and stands down when none was declared", () => {
    const wiring = (
      JSON.parse(
        readFileSync(
          resolve(GUARD, "../../../hooks/claude/.claude/settings.json"),
          "utf8",
        ),
      ) as {
        hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
      }
    ).hooks.PreToolUse[0]?.hooks[0]?.command;
    const run = (policy?: string) =>
      spawnSync("sh", ["-c", wiring ?? ""], {
        input: JSON.stringify({ tool_input: { command: "ls" } }),
        env: {
          PATH: process.env.PATH,
          HOME: "/nonexistent",
          ...(policy ? { LORE_TEST_POLICY: policy } : {}),
        },
      });

    expect({
      declared: run("none").status,
      reason: run("none").stderr.toString(),
      undeclared: run().status,
    }).toEqual({
      declared: 2,
      reason: expect.stringMatching(
        /^\[lore\] blocked: .*guard script is missing/,
      ),
      undeclared: 0,
    });
  });

  it("refuses eslint, prettier and a lint script under policy none, where CI has already published that verdict", () => {
    expect([
      blocked("npx eslint apps/web-ui/src/app/api/route.ts", "none"),
      blocked("cd /workspace/target && npx eslint .", "none"),
      blocked("npm run lint -- --ext .ts", "none"),
      blocked("prettier --check src/a.ts", "none"),
      blocked("node_modules/.bin/eslint src", "none"),
    ]).toEqual([true, true, true, true, true]);
  });

  it("names CI's verdict as where to read it instead", () => {
    expect(guard("npx eslint .", "none").reason).toContain(
      "lore_get_ci_failures",
    );
  });

  it("leaves a linter alone under the scoped policy an implementation pod runs", () => {
    expect(blocked("npx eslint src/a.ts", "scoped")).toBe(false);
  });

  it("wires the same guard into the Gemini bundle, which blocks with a decision on stdout rather than an exit code", () => {
    const settings = JSON.parse(
      readFileSync(
        resolve(GUARD, "../../../hooks/gemini/.gemini/settings.json"),
        "utf8",
      ),
    ) as {
      hooks: {
        BeforeTool: Array<{
          matcher: string;
          hooks: Array<{ type: string; command: string }>;
        }>;
      };
    };
    const hook = settings.hooks.BeforeTool[0];

    expect(hook.matcher).toEqual("run_shell_command");
    expect(hook.hooks[0].command).toContain(
      "$HOME/.claude/skills/lore-context/guard-tests.sh",
    );
    expect(hook.hooks[0].command).toContain('"decision":"block"');
  });

  it("blocks an install through the Gemini hook and passes a read-only command", () => {
    expect([
      geminiDecision("npm install", "none"),
      geminiDecision("git -C /workspace/target diff main...HEAD", "none"),
    ]).toEqual([
      "[lore] blocked: this node does not install dependencies or build. The pod has a 1Gi disk budget and CI already builds the branch.",
      null,
    ]);
  });
});
