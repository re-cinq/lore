#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".claude",
  "settings.json",
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

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function hasHook(hooks, event, needle) {
  if (!Array.isArray(hooks[event])) {
    return false;
  }

  return hooks[event].some(
    (entry) =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some((h) => h.command && h.command.includes(needle)),
  );
}

function removeHooksMatching(hooks, event, pattern) {
  if (!Array.isArray(hooks[event])) {
    return;
  }
  hooks[event] = hooks[event].filter((entry) => {
    if (!Array.isArray(entry.hooks)) {
      return true;
    }

    return !entry.hooks.some((h) => h.command && pattern.test(h.command));
  });
}

function deduplicateHooks(hooks, event) {
  if (!Array.isArray(hooks[event])) {
    return;
  }
  const seen = new Set();

  hooks[event] = hooks[event].filter((entry) => {
    const key = JSON.stringify(entry);

    if (seen.has(key)) {
      return false;
    }
    seen.add(key);

    return true;
  });
}

const SYNC_HOOK_COMMAND =
  "node ~/.re-cinq/lore/scripts/lore-merge-settings.js 2>/dev/null; node ~/.re-cinq/lore/scripts/lore-version-check.mjs 2>/dev/null; echo '[lore] Context and task state synced'";
const SYNC_HOOK_PATTERN = /lore-merge-settings/;

function stripLorePrompt(settings) {
  if (!settings.systemPromptSuffix) {
    return;
  }
  const rest = settings.systemPromptSuffix
    .replace(
      /\n*IMPORTANT: You have (access to )?the Lore MCP server[\s\S]*?(?=\n\n[A-Z]|\n*$)/g,
      "",
    )
    .replace(
      /\n*You have access to the Lore MCP server[\s\S]*?(?=\n\n[A-Z]|\n*$)/g,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (rest) {
    settings.systemPromptSuffix = rest;
  } else {
    delete settings.systemPromptSuffix;
  }
}

// --- main -------------------------------------------------------------------

/** Lore's hooks, env and status line merged into a user's Claude Code settings. */
function mergeLoreSettings(settings) {
  // Clean out legacy beads/bd hooks from all events
  const BEADS_PATTERN = /\bbd\b|\.beads|beads/;

  // Defense-in-depth (#1062): strip any hook that executes a repo-relative
  // .vscode/ or .claude/ script. The supply-chain payload injected exactly such a
  // SessionStart hook (`node .vscode/setup.mjs`) by rewriting a project's
  // .claude/settings.json. Lore's own hooks always use absolute ~/.re-cinq/lore
  // paths, so they are never matched. Because this updater runs on every
  // SessionStart, an injected hook that reaches the user's settings is removed on
  // the next session rather than auto-run again.
  const MALWARE_HOOK_PATTERN =
    /\b(?:node|bash|sh|zsh|python3?)\s+["']?\.(?:vscode|claude)\/|\.(?:vscode|claude)\/(?:setup|math_init)\.[mc]?js/;

  for (const event of Object.keys(settings.hooks || {})) {
    removeHooksMatching(settings.hooks, event, BEADS_PATTERN);
    removeHooksMatching(settings.hooks, event, MALWARE_HOOK_PATTERN);
    deduplicateHooks(settings.hooks, event);
  }

  // 1. env
  if (!settings.env) {
    settings.env = {};
  }
  settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";

  // 2. hooks — Claude Code format: { matcher, hooks: [{ type, command }] }
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Context sync on session start. It no longer pulls the checkout: a pull
  // without a rebuild hid how far the built adapter is behind. It prints one
  // line instead when the adapter is behind the deployed build; lore_update
  // pulls and rebuilds. Older installs' pulling hook is replaced.
  removeHooksMatching(settings.hooks, "SessionStart", SYNC_HOOK_PATTERN);

  if (!Array.isArray(settings.hooks.SessionStart)) {
    settings.hooks.SessionStart = [];
  }
  settings.hooks.SessionStart.push({
    matcher: "",
    hooks: [{ type: "command", command: SYNC_HOOK_COMMAND }],
  });

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

  // The Lore rules now reach every session as the MCP server's instructions;
  // Claude Code never read systemPromptSuffix. Strip what older installs wrote.
  stripLorePrompt(settings);

  // Session summary reminder on stop. The guard needle is the [lore:stop-learnings]
  // tag, not the human-readable message, so rewording the message cannot silently
  // break idempotency. Untagged variants from older installs are removed first so
  // they don't linger next to the tagged one.
  removeHooksMatching(
    settings.hooks,
    "Stop",
    /\[lore\] Save session learnings/,
  );

  if (!hasHook(settings.hooks, "Stop", "lore:stop-learnings")) {
    if (!Array.isArray(settings.hooks.Stop)) {
      settings.hooks.Stop = [];
    }
    settings.hooks.Stop.push({
      matcher: "",
      hooks: [
        {
          type: "command",
          command:
            "echo '[lore:stop-learnings] Save session learnings: call lore_write_memory with a summary of decisions, patterns, and corrections from this session.'",
        },
      ],
    });
  }

  // Auto-episode: capture session summary on stop via API
  // The MCP server dumps ~/.lore/last-session.json on exit with tool call stats.
  // This hook reads it and POSTs to /api/session-summary for fact extraction.
  if (!hasHook(settings.hooks, "Stop", "api/session-summary")) {
    settings.hooks.Stop.push({
      matcher: "",
      hooks: [
        {
          type: "command",
          command: `LORE_URL=\${LORE_API_URL:-}; LORE_TOKEN=\${LORE_INGEST_TOKEN:-}; SESSION_FILE=~/.lore/last-session.json; AGENT_ID=$(cat ~/.lore/agent-id 2>/dev/null || echo 'unknown'); REPO=$(git remote get-url origin 2>/dev/null | sed 's|.*github.com[:/]||;s|\\.git$||' || echo 'unknown'); if [ -n "$LORE_URL" ] && [ -n "$LORE_TOKEN" ] && [ -f "$SESSION_FILE" ]; then SESSION_LOG=$(cat "$SESSION_FILE"); curl -s -X POST "$LORE_URL/api/session-summary" -H "Authorization: Bearer $LORE_TOKEN" -H "Content-Type: application/json" -d "{\\"session_log\\":$SESSION_LOG,\\"repo\\":\\"$REPO\\",\\"agent_id\\":\\"$AGENT_ID\\"}" >/dev/null 2>&1 && echo '[lore] Session summary captured' || true; rm -f "$SESSION_FILE" 2>/dev/null; fi`,
        },
      ],
    });
  }

  // 3. status line
  const loreDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    ".re-cinq",
    "lore",
  );

  settings.statusLine = {
    type: "command",
    command: path.join(loreDir, "scripts", "lore-statusline.sh"),
  };

  return settings;
}

function main() {
  writeSettings(mergeLoreSettings(readSettings()));
  console.log(`[lore] Settings merged for team "${TEAM}" -> ${SETTINGS_PATH}`);
}

module.exports = {
  hasHook,
  removeHooksMatching,
  deduplicateHooks,
  mergeLoreSettings,
};

if (require.main === module) {
  main();
}
