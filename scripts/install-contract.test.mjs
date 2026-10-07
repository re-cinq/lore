import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Drift detector: pins the documented behaviour of scripts/install.sh so a
// refactor that silently drops a step (clone / build / team / settings / skills
// / health check) or breaks an idempotency guard turns this file red.
const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "install.sh");
const script = readFileSync(scriptPath, "utf8");

test("clones the context repo with a depth-1 shallow clone into LORE_DIR", () => {
  assert.match(
    script,
    /git clone --depth 1 "\$clone_src" "\$LORE_DIR"/,
    "install_context must shallow-clone the context repo into $LORE_DIR",
  );
  assert.match(
    script,
    /clone_src="\$\(git -C "\$REPO_DIR" remote get-url origin/,
    "clone source resolves from the local checkout's origin remote",
  );
});

test("falls back to the canonical repo URL when origin is unavailable", () => {
  assert.match(
    script,
    /LORE_REPO_URL:-git@github\.com:re-cinq\/lore\.git/,
    "LORE_REPO_URL defaults to the canonical re-cinq/lore git URL",
  );
  assert.match(
    script,
    /\[ -z "\$clone_src" \] && clone_src="\$LORE_REPO_URL"/,
    "empty clone_src falls back to LORE_REPO_URL",
  );
});

test("clones only when the context directory is absent, otherwise updates", () => {
  assert.match(
    script,
    /if \[ ! -d "\$LORE_DIR" \]; then\n\s*echo "\[lore\] Installing to \$LORE_DIR/,
    "the clone path is guarded by the absent-directory check",
  );
  assert.match(
    script,
    /else\n\s*echo "\[lore\] Updating \.\.\."\n\s*git -c http\.timeout=10 -C "\$LORE_DIR" pull --quiet --ff-only/,
    "an existing directory is updated via a fast-forward-only pull, not re-cloned",
  );
});

test("builds shared, server-core and the MCP adapter in one workspace build", () => {
  assert.match(
    script,
    /npm run build -w @re-cinq\/lore-shared -w @re-cinq\/lore-server-core -w @re-cinq\/lore-mcp/,
    "build_mcp_server compiles shared + server-core + mcp adapter together",
  );
  assert.match(
    script,
    // --ignore-scripts on BOTH: a dependency's install hook is the supply-chain
    // seam the keyv/cache-manager compromise came through (#1062). Dropping it
    // from either half of the fallback reopens it.
    /npm ci --ignore-scripts --silent 2>&1 \|\| npm install --ignore-scripts --silent 2>&1/,
    "dependencies install via npm ci with an npm install fallback",
  );
});

test("detects the team from git config and defaults to platform when unset", () => {
  assert.match(
    script,
    /TEAM="\$\(git config --global lore\.team 2>\/dev\/null \|\| true\)"/,
    "team is read from the global lore.team git config",
  );
  assert.match(
    script,
    /if \[ -z "\$TEAM" \]; then\n\s*TEAM="platform"\n\s*git config --global lore\.team "\$TEAM"/,
    "an unset team defaults to 'platform' and is persisted back to git config",
  );
});

test("registers the MCP server with the claude CLI pointing at the built adapter", () => {
  assert.match(
    script,
    /claude mcp remove -s local lore-context[^\n]*\|\| true\n\s*claude mcp remove -s user lore-context[^\n]*\|\| true/,
    "a stale local or user lore-context registration is removed before re-adding",
  );
  assert.match(
    script,
    /claude mcp add -s user \\\n(\s*-e "[A-Z_]+=\$[A-Za-z_]+" \\\n)+\s*lore-context -- node "\$LORE_DIR\/apps\/mcp-server\/dist\/index\.js"/,
    "options precede the name and -- precedes the command running the built dist/index.js",
  );
});

test("registers at user scope so Lore works in every repo, never the cwd-bound local scope", () => {
  assert.doesNotMatch(
    script,
    /claude mcp add (?!-s user)/,
    "every claude mcp add names the user scope",
  );
  assert.match(
    script,
    /-e "CONTEXT_PATH=\$LORE_DIR"/,
    "the adapter learns where the context checkout lives",
  );
  assert.match(
    script,
    /-e "LORE_API_URL=\$LORE_API_URL"/,
    "the adapter receives the API URL",
  );
  assert.match(
    script,
    /-e "LORE_INGEST_TOKEN=\$LORE_TOKEN"/,
    "the adapter receives the token",
  );
});

test("does not pass LORE_TEAM, which nothing reads", () => {
  assert.doesNotMatch(
    script,
    /LORE_TEAM/,
    "no LORE_TEAM env var is registered",
  );
});

test("fails with a clear error when claude is missing or registration fails", () => {
  assert.match(
    script,
    /if ! command -v claude &>\/dev\/null; then\n\s*echo "\[lore\] Error: 'claude' is required[^\n]*\n[^\n]*\n\s*return 1/,
    "a missing claude CLI is an error, not a silent skip",
  );
  assert.match(
    script,
    /else\n\s*echo "\[lore\] Error: 'claude mcp add -s user lore-context' failed[^\n]*\n[^\n]*\n\s*return 1/,
    "a failed claude mcp add is an error",
  );
  assert.doesNotMatch(
    script,
    /falling back to settings\.json/,
    "the settings.json fallback never existed and is not promised",
  );
});

test("an env-provided API URL and token win over git config", () => {
  assert.match(
    script,
    /LORE_API_URL="\$\{LORE_API_URL:-\$\(git config --global lore\.api-url 2>\/dev\/null \|\| true\)\}"/,
    "LORE_API_URL from the environment is kept; git config is only the fallback",
  );
  assert.match(
    script,
    /LORE_TOKEN="\$\{LORE_INGEST_TOKEN:-\$\(git config --global lore\.ingest-token 2>\/dev\/null \|\| true\)\}"/,
    "LORE_INGEST_TOKEN from the environment is kept; git config is only the fallback",
  );
});

test("prompts for the API URL on the tty and never writes an empty value to git config", () => {
  assert.match(
    script,
    /read -r -p "\[lore\] Lore API URL: " LORE_API_URL < \/dev\/tty/,
    "the URL prompt reads the terminal like the token prompt",
  );
  const urlGuard = script.indexOf(
    'if [ -z "$LORE_API_URL" ]; then\n    echo "[lore] Error: no Lore API URL',
  );
  const tokenGuard = script.indexOf(
    'if [ -z "$LORE_TOKEN" ]; then\n    echo "[lore] Error: no Lore API token',
  );
  const urlWrite = script.indexOf(
    'git config --global lore.api-url "$LORE_API_URL"',
  );
  const tokenWrite = script.indexOf(
    'git config --global lore.ingest-token "$LORE_TOKEN"',
  );

  assert.ok(urlGuard !== -1 && tokenGuard !== -1, "both values are guarded");
  assert.ok(
    urlGuard < urlWrite && tokenGuard < tokenWrite,
    "each write follows its non-empty guard",
  );
  assert.equal(
    script.split('git config --global lore.api-url "$LORE_API_URL"').length - 1,
    1,
    "the URL is written to git config in exactly one place",
  );
});

test("merges Claude Code settings by delegating to lore-merge-settings.js with the team", () => {
  assert.match(
    script,
    /node "\$LORE_DIR\/scripts\/lore-merge-settings\.js" "\$TEAM"/,
    "env vars, hooks and status line are merged via lore-merge-settings.js with $TEAM",
  );
});

test("installs each platform skill into the user's global skills directory", () => {
  assert.match(
    script,
    /mkdir -p "\$HOME\/\.claude\/skills"/,
    "the global skills directory is created before copying",
  );
  assert.match(
    script,
    /for skill_dir in "\$LORE_DIR\/\.claude\/skills\/"\*\/; do/,
    "every skill directory under the context repo is iterated",
  );
  assert.match(
    script,
    /dest="\$HOME\/\.claude\/skills\/\$name"/,
    "skills copy to $HOME/.claude/skills/<name>",
  );
});

test("refreshes a changed platform skill rather than skipping it", () => {
  // Deliberately NOT a skip: a stale installed copy makes /lore-help describe
  // behaviour that is not installed, and lore-doctor fails on the difference.
  // Three outcomes, one per state — absent, identical, changed.
  assert.match(
    script,
    /if \[ ! -d "\$dest" \]; then\n\s*cp -r "\$skill_dir" "\$dest"/,
    "an absent skill is installed",
  );
  assert.match(
    script,
    /elif diff -rq "\$skill_dir" "\$dest" >\/dev\/null 2>&1; then\n\s*echo "  Up to date/,
    "an identical skill is left alone and reported up to date",
  );
  assert.match(
    script,
    /else\n\s*cp -r "\$skill_dir\/\." "\$dest\/"\n\s*echo "  Updated/,
    "a CHANGED skill is refreshed in place, not skipped",
  );
});

test("generates the agent id only when the id file does not yet exist", () => {
  assert.match(
    script,
    /if \[ ! -f "\$AGENT_ID_FILE" \]; then\n\s*uuidgen > "\$AGENT_ID_FILE"/,
    "a new agent id is generated only when the id file is absent",
  );
  assert.match(
    script,
    /echo "\[lore\] Agent ID exists: \$\(cat "\$AGENT_ID_FILE"\)"/,
    "an existing agent id file is reported, not regenerated",
  );
});

test("runs the lore-doctor health check as the final diagnostic step", () => {
  assert.match(
    script,
    /"\$LORE_DIR\/scripts\/lore-doctor\.sh" \|\| true/,
    "diagnostics run lore-doctor.sh (non-fatal) at the end of install",
  );
  assert.match(
    script,
    /echo "\[lore\] Installation complete\."/,
    "install finishes by reporting completion",
  );
});

test("runs the install steps in the documented order", () => {
  const order = [
    "install_context",
    "build_mcp_server",
    "select_team",
    "merge_settings",
    "install_skills",
    "install_specify",
    "generate_agent_id",
    "install_agentdb",
  ];
  const runSection = script.slice(script.indexOf("# --- Run all steps"));
  const positions = order.map((step) => runSection.indexOf(`\n${step}\n`));

  assert.ok(
    positions.every((p) => p !== -1),
    "every documented step is invoked in the run block",
  );
  const sorted = [...positions].sort((a, b) => a - b);

  assert.deepEqual(
    positions,
    sorted,
    "steps are invoked in the documented order",
  );
});

const doctorPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "lore-doctor.sh",
);

function runDoctor({
  env = {},
  claudeOk = true,
  httpCode = "200",
  health = "{}",
} = {}) {
  const home = mkdtempSync(join(tmpdir(), "lore-doctor-"));
  const bin = join(home, "bin");

  mkdirSync(bin);
  const stub = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };

  stub("claude", claudeOk ? "exit 0" : "exit 1");
  stub(
    "curl",
    `case "$*" in *"-w"*) printf '%s' "$STUB_HTTP_CODE";; *) printf '%s' "$STUB_HEALTH";; esac`,
  );
  stub("ssh", "exit 1");
  const result = spawnSync("bash", [doctorPath], {
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
      GIT_CONFIG_SYSTEM: "/dev/null",
      STUB_HTTP_CODE: httpCode,
      STUB_HEALTH: health,
      ...env,
    },
  });

  rmSync(home, { recursive: true, force: true });

  return { ...result, lines: result.stdout.trimEnd().split("\n") };
}

const fixtureToken = () => `fixture-${randomBytes(6).toString("hex")}`;
const hasJq = spawnSync("jq", ["--version"]).status === 0;
const apiEnv = () => ({
  LORE_API_URL: "https://lore-api.example.test",
  LORE_INGEST_TOKEN: fixtureToken(),
});

test("lore-doctor fails, not 'optional', when the API URL and token are missing", () => {
  const { stdout, status } = runDoctor();

  assert.match(stdout, /✗ {2}Lore API URL configured/);
  assert.match(stdout, /✗ {2}Lore API token configured/);
  assert.doesNotMatch(stdout, /optional\)\n.*Task delegation/);
  assert.notEqual(status, 0);
});

test("lore-doctor checks lore-context is registered by running claude mcp get from HOME", () => {
  assert.match(
    readFileSync(doctorPath, "utf8"),
    /\(cd "\$HOME" && claude mcp get lore-context\)/,
  );
  assert.match(
    runDoctor({ claudeOk: true }).stdout,
    /✓ {2}lore-context MCP server registered/,
  );
  assert.match(
    runDoctor({ claudeOk: false }).stdout,
    /✗ {2}lore-context MCP server registered/,
  );
});

test("lore-doctor reports a rejected token separately from an outage", () => {
  const env = apiEnv();

  for (const httpCode of ["401", "403"]) {
    const { stdout } = runDoctor({ env, httpCode });

    assert.match(stdout, new RegExp(`token rejected \\(HTTP ${httpCode}\\)`));
    assert.doesNotMatch(stdout, /unreachable/);
  }
  const outage = runDoctor({ env, httpCode: "000" }).stdout;

  assert.match(outage, /Lore API unreachable/);
  assert.doesNotMatch(outage, /token rejected/);
  assert.match(
    runDoctor({ env, httpCode: "200" }).stdout,
    /Lore API accepts the token/,
  );
});

test("lore-doctor reads the URL and token from the environment before git config", () => {
  const { stdout } = runDoctor({ env: apiEnv() });

  assert.match(stdout, /✓ {2}Lore API URL configured/);
  assert.match(stdout, /✓ {2}Lore API token configured/);
});

test(
  "lore-doctor blames the token scope, not Vertex AI, when healthz has no embeddings key",
  { skip: !hasJq },
  () => {
    const env = apiEnv();
    const noKey = runDoctor({ env, health: '{"status":"ok"}' }).stdout;

    assert.match(noKey, /token lacks read scope/);
    assert.doesNotMatch(noKey, /Vertex AI/);
    const bad = runDoctor({
      env,
      health: '{"embeddings":{"consecutiveFailures":3}}',
    }).stdout;

    assert.match(bad, /cannot reach Vertex AI/);
    const good = runDoctor({
      env,
      health: '{"embeddings":{"consecutiveFailures":0}}',
    }).stdout;

    assert.match(good, /✓ {2}Embeddings healthy/);
  },
);

test("lore-doctor prints the Results line last", () => {
  const env = apiEnv();

  for (const httpCode of ["200", "401", "000"]) {
    const { lines } = runDoctor({ env, httpCode, health: '{"status":"ok"}' });

    assert.match(
      lines[lines.length - 1],
      /^\[lore\] Results: \d+ passed, \d+ failed$/,
    );
  }
});
