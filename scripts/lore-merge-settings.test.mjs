import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hasHook,
  removeHooksMatching,
  deduplicateHooks,
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
