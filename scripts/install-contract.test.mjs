import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    /npm ci --silent 2>&1 \|\| npm install --silent 2>&1/,
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
    /claude mcp remove lore-context 2>\/dev\/null \|\| true/,
    "a stale lore-context registration is removed before re-adding",
  );
  assert.match(
    script,
    /claude mcp add lore-context node \\\n\s*"\$LORE_DIR\/apps\/mcp-server\/dist\/index\.js"/,
    "the MCP server is registered as node running the built dist/index.js",
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

test("skips installing a platform skill that already exists", () => {
  assert.match(
    script,
    /if \[ ! -d "\$dest" \]; then\n\s*cp -r "\$skill_dir" "\$dest"/,
    "a skill is copied only when its destination is absent",
  );
  assert.match(
    script,
    /echo "  Skipped \/\$\(basename "\$skill_dir"\) \(already exists\)"/,
    "an existing skill destination is reported as skipped",
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
  assert.deepEqual(positions, sorted, "steps are invoked in the documented order");
});
