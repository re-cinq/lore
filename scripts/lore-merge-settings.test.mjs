import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hasHook,
  removeHooksMatching,
  deduplicateHooks,
  mergeLoreSettings,
} from "./lore-merge-settings.js";

const personalHook = {
  matcher: "",
  hooks: [{ type: "command", command: "echo 'my personal session hook'" }],
};

const loreHook = {
  matcher: "",
  hooks: [
    {
      type: "command",
      command: "node ~/.re-cinq/lore/scripts/lore-merge-settings.js",
    },
  ],
};

test("merge leaves an existing personal SessionStart hook untouched", () => {
  const hooks = { SessionStart: [personalHook] };

  // The lore hook is absent, so the installer adds it rather than overwriting.
  assert.equal(hasHook(hooks, "SessionStart", "lore-merge-settings"), false);
  // The personal hook is recognized and survives the dedup cleanup pass.
  assert.equal(
    hasHook(hooks, "SessionStart", "my personal session hook"),
    true,
  );

  deduplicateHooks(hooks, "SessionStart");

  assert.deepEqual(hooks.SessionStart, [personalHook]);
});

test("deduplicateHooks removes identical duplicate entries and keeps distinct ones", () => {
  const hooks = {
    SessionStart: [
      structuredClone(loreHook),
      structuredClone(loreHook),
      personalHook,
    ],
  };

  deduplicateHooks(hooks, "SessionStart");

  assert.deepEqual(hooks.SessionStart, [loreHook, personalHook]);
});

test("removeHooksMatching removes only entries whose command matches the pattern", () => {
  const beadsHook = {
    matcher: "",
    hooks: [{ type: "command", command: "bd sync --beads" }],
  };
  const hooks = { SessionStart: [beadsHook, personalHook, loreHook] };

  removeHooksMatching(hooks, "SessionStart", /\bbd\b|\.beads|beads/);

  assert.deepEqual(hooks.SessionStart, [personalHook, loreHook]);
});

const OLD_SYNC_HOOK = {
  matcher: "",
  hooks: [
    {
      type: "command",
      command:
        "git -C ~/.re-cinq/lore pull --quiet --ff-only 2>/dev/null; node ~/.re-cinq/lore/scripts/lore-merge-settings.js 2>/dev/null; echo '[lore] Context and task state synced'",
    },
  ],
};

function sessionStartCommands(settings) {
  return settings.hooks.SessionStart.flatMap((entry) =>
    entry.hooks.map((h) => h.command),
  );
}

test("mergeLoreSettings replaces the pulling sync hook with one that checks the deployed version", () => {
  const merged = mergeLoreSettings({
    hooks: { SessionStart: [structuredClone(OLD_SYNC_HOOK)] },
  });
  const sync = sessionStartCommands(merged).filter((c) =>
    c.includes("lore-merge-settings"),
  );

  assert.equal(sync.length, 1);
  assert.doesNotMatch(sync[0], /git .*pull/);
  assert.match(sync[0], /lore-version-check\.mjs/);
});

test("mergeLoreSettings writes no systemPromptSuffix and strips the Lore block an older install left", () => {
  const merged = mergeLoreSettings({
    systemPromptSuffix:
      "Be brief.\n\nIMPORTANT: You have the Lore MCP server (lore-context). Follow these rules strictly:\n\n1. FIRST ACTION: Call lore_assemble_context.",
  });

  assert.equal(merged.systemPromptSuffix, "Be brief.");
});

test("mergeLoreSettings drops a systemPromptSuffix that held only the Lore block", () => {
  const merged = mergeLoreSettings({
    systemPromptSuffix:
      "\nIMPORTANT: You have the Lore MCP server (lore-context). Follow these rules strictly:\n\n1. FIRST ACTION: Call lore_assemble_context.",
  });

  assert.equal("systemPromptSuffix" in merged, false);
});
