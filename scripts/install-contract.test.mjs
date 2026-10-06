import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "install.sh");
const script = readFileSync(scriptPath, "utf8");

test("clones the context repo with a depth-1 shallow clone into LORE_DIR", () => {
  assert.match(script, /git clone --depth 1 "\$clone_src" "\$LORE_DIR"/);
  assert.match(script, /clone_src="\$\(git -C "\$REPO_DIR" remote get-url origin/);
});

test("builds the shared libraries and MCP adapter without dependency lifecycle scripts", () => {
  assert.match(script, /npm ci --ignore-scripts --silent 2>&1 \|\| npm install --ignore-scripts --silent 2>&1/);
  assert.match(script, /npm run build -w @re-cinq\/lore-shared -w @re-cinq\/lore-server-core -w @re-cinq\/lore-mcp/);
});

test("selects and persists a default Lore team", () => {
  assert.match(script, /TEAM="\$\(git config --global lore\.team 2>\/dev\/null \|\| true\)"/);
  assert.match(script, /TEAM="platform"/);
});

test("registers the MCP adapter with the Codex CLI", () => {
  assert.match(script, /codex mcp remove lore-context 2>\/dev\/null \|\| true/);
  assert.match(script, /codex mcp add lore-context "\$\{MCP_ENV_ARGS\[@\]\}" -- node/);
  assert.match(script, /"\$LORE_DIR\/apps\/mcp-server\/dist\/index\.js"/);
  assert.match(script, /--env "CONTEXT_PATH=\$LORE_DIR"/);
});

test("installs and refreshes all platform skills in Codex's global skills directory", () => {
  assert.match(script, /mkdir -p "\$HOME\/\.codex\/skills"/);
  assert.match(script, /for skill_dir in "\$LORE_DIR\/\.codex\/skills\/"\*\/; do/);
  assert.match(script, /dest="\$HOME\/\.codex\/skills\/\$name"/);
  assert.match(script, /elif diff -rq "\$skill_dir" "\$dest" >\/dev\/null 2>&1; then/);
  assert.match(script, /cp -r "\$skill_dir\/\." "\$dest\/"/);
});

test("runs the installation steps in the documented order", () => {
  const order = ["install_context", "build_mcp_server", "select_team", "configure_codex", "install_skills", "install_specify", "generate_agent_id", "install_agentdb"];
  const runSection = script.slice(script.indexOf("# --- Run all steps"));
  const positions = order.map((step) => runSection.indexOf(`\n${step}\n`));

  assert.ok(positions.every((position) => position !== -1));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});
