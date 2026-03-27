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

function hookExists(hooks, type, needle) {
  if (!Array.isArray(hooks[type])) return false;
  return hooks[type].some((h) => h.command && h.command.includes(needle));
}

// --- main -------------------------------------------------------------------

const settings = readSettings();

// 1. env
if (!settings.env) settings.env = {};
settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";

// 2. mcpServers
if (!settings.mcpServers) settings.mcpServers = {};
settings.mcpServers["lore-context"] = {
  command: "node",
  args: ["${HOME}/.lore/context/mcp-server/dist/index.js"],
  env: {
    CONTEXT_PATH: "${HOME}/.lore/context",
    LORE_TEAM: TEAM,
  },
};

// 3. hooks (append, never overwrite)
if (!settings.hooks) settings.hooks = {};

// SessionStart
if (!hookExists(settings.hooks, "SessionStart", "lore/context pull")) {
  if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];
  settings.hooks.SessionStart.push({
    command: "git -C ~/.lore/context pull --quiet --ff-only 2>/dev/null; bd pull --quiet 2>/dev/null; echo '[lore] Context and task state synced'",
  });
}

// PostToolUse (Write|Edit|MultiEdit)
if (!hookExists(settings.hooks, "PostToolUse", "bd update")) {
  if (!Array.isArray(settings.hooks.PostToolUse)) settings.hooks.PostToolUse = [];
  settings.hooks.PostToolUse.push({
    matcher: "Write|Edit|MultiEdit",
    command:
      "TASK=$(bd list --claimed --json 2>/dev/null | jq -r '.[0].id // empty'); [ -n \"$TASK\" ] && bd update $TASK --progress 2>/dev/null || true",
  });
}

// Stop
if (!hookExists(settings.hooks, "Stop", "bd update")) {
  if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];
  settings.hooks.Stop.push({
    command:
      "TASK=$(bd list --claimed --json 2>/dev/null | jq -r '.[0].id // empty'); [ -n \"$TASK\" ] && echo \"[lore] Active task: $TASK \\u2014 run 'bd update $TASK --status done' if finished\"",
  });
}

// 4. write
writeSettings(settings);
console.log(`[lore] Settings merged for team "${TEAM}" -> ${SETTINGS_PATH}`);
