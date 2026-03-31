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

// 2. hooks — Claude Code format: { matcher, hooks: [{ type, command }] }
if (!settings.hooks) settings.hooks = {};

// Context sync on session start
if (!hasHook(settings.hooks, "SessionStart", "re-cinq/lore")) {
  if (!Array.isArray(settings.hooks.SessionStart))
    settings.hooks.SessionStart = [];
  settings.hooks.SessionStart.push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command:
          "git -C ~/.re-cinq/lore pull --quiet --ff-only 2>/dev/null; echo '[lore] Context synced'",
      },
    ],
  });
}

// Status cache (feeds the status line with pipeline metrics)
if (!hasHook(settings.hooks, "SessionStart", "lore-status-cache")) {
  settings.hooks.SessionStart.push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command:
          "bash ~/.re-cinq/lore/scripts/lore-status-cache.sh 2>/dev/null &",
      },
    ],
  });
}

// 3. status line
const loreDir = path.join(process.env.HOME || process.env.USERPROFILE, ".re-cinq", "lore");
settings.statusLine = {
  type: "command",
  command: path.join(loreDir, "scripts", "lore-statusline.sh"),
};

// 4. write
writeSettings(settings);
console.log(`[lore] Settings merged for team "${TEAM}" -> ${SETTINGS_PATH}`);
