#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".claude",
  "settings.json"
);
const TEAM = process.argv[2] || "platform";

// --- helpers ----------------------------------------------------------------

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(obj) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function hasHook(hooks, event, needle) {
  if (!Array.isArray(hooks[event])) return false;
  return hooks[event].some((entry) =>
    Array.isArray(entry.hooks) &&
    entry.hooks.some((h) => h.command && h.command.includes(needle))
  );
}

// --- main -------------------------------------------------------------------

const settings = readSettings();

// 1. env
if (!settings.env) settings.env = {};
settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";

// 2. mcpServers — registered via `claude mcp add` in install.sh (not here)
//    The CLI writes to the correct location regardless of Claude Code version.

// 3. hooks — Claude Code format: { matcher, hooks: [{ type, command }] }
if (!settings.hooks) settings.hooks = {};

if (!hasHook(settings.hooks, "SessionStart", "re-cinq/lore")) {
  if (!Array.isArray(settings.hooks.SessionStart))
    settings.hooks.SessionStart = [];
  settings.hooks.SessionStart.push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command:
          "git -C ~/.re-cinq/lore pull --quiet --ff-only 2>/dev/null; bd pull --quiet 2>/dev/null; [ ! -d .beads ] && command -v bd &>/dev/null && bd init --quiet 2>/dev/null; echo '[lore] Context and task state synced'",
      },
    ],
  });
}

if (!hasHook(settings.hooks, "PostToolUse", "bd update")) {
  if (!Array.isArray(settings.hooks.PostToolUse))
    settings.hooks.PostToolUse = [];
  settings.hooks.PostToolUse.push({
    matcher: "Write|Edit|MultiEdit",
    hooks: [
      {
        type: "command",
        command:
          'TASK=$(bd list --claimed --json 2>/dev/null | jq -r \'.[0].id // empty\' 2>/dev/null) || true; [ -n "$TASK" ] && bd update $TASK --progress 2>/dev/null || true',
      },
    ],
  });
}

if (!hasHook(settings.hooks, "Stop", "Active task")) {
  if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];
  settings.hooks.Stop.push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command:
          'TASK=$(bd list --claimed --json 2>/dev/null | jq -r \'.[0].id // empty\' 2>/dev/null) || true; [ -n "$TASK" ] && echo "[lore] Active task: $TASK \u2014 run \'bd update $TASK --status done\' if finished" || true',
      },
    ],
  });
}

// 4. write
writeSettings(settings);
console.log(`[lore] Settings merged for team "${TEAM}" -> ${SETTINGS_PATH}`);
