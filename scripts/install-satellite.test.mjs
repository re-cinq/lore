import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(repoRoot, "scripts", "install-satellite.sh");

// The flag-parsing loop in install-satellite.sh runs before any helm/kubectl
// check. An unknown flag exits immediately with `unknown flag: <name>`. A
// recognised flag is consumed and the script fails later on a missing required
// value or missing tool — never with an unknown-flag error.

test("--mcp-url is a recognised flag, not an unknown one (#1629)", () => {
  const { stderr } = spawnSync(
    "bash",
    [scriptPath, "--mcp-url", "https://lore-mcp.example.com/mcp"],
    { encoding: "utf8" },
  );

  assert.ok(
    !stderr.includes("unknown flag: --mcp-url"),
    `expected --mcp-url to be recognised but script rejected it: ${stderr.trim()}`,
  );
});
