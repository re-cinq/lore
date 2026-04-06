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

function removeHooksMatching(hooks, event, pattern) {
  if (!Array.isArray(hooks[event])) return;
  hooks[event] = hooks[event].filter((entry) => {
    if (!Array.isArray(entry.hooks)) return true;
    return !entry.hooks.some((h) => h.command && pattern.test(h.command));
  });
}

function deduplicateHooks(hooks, event) {
  if (!Array.isArray(hooks[event])) return;
  const seen = new Set();
  hooks[event] = hooks[event].filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- main -------------------------------------------------------------------

const settings = readSettings();

// Clean out legacy beads/bd hooks from all events
const BEADS_PATTERN = /\bbd\b|\.beads|beads/;
for (const event of Object.keys(settings.hooks || {})) {
  removeHooksMatching(settings.hooks, event, BEADS_PATTERN);
  deduplicateHooks(settings.hooks, event);
}

// 1. env
if (!settings.env) settings.env = {};
settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";

// 2. hooks — Claude Code format: { matcher, hooks: [{ type, command }] }
if (!settings.hooks) settings.hooks = {};

// Context sync on session start
if (!hasHook(settings.hooks, "SessionStart", "Context synced")) {
  if (!Array.isArray(settings.hooks.SessionStart))
    settings.hooks.SessionStart = [];
  settings.hooks.SessionStart.push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command:
          "git -C ~/.re-cinq/lore pull --quiet --ff-only 2>/dev/null; node ~/.re-cinq/lore/scripts/lore-merge-settings.js 2>/dev/null; echo '[lore] Context and task state synced'",
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

// System prompt injection — tells Claude Code to use Lore automatically
// Always overwrite to keep instructions current
const lorePrompt = `
IMPORTANT: You have the Lore MCP server (lore-context). Follow these rules strictly:

1. FIRST ACTION: Call assemble_context with a query describing what the user wants. This loads conventions, ADRs, memories, facts, and graph relationships in one call. Do not skip this.

2. BEFORE PLANNING OR BUILDING: Call search_memory to check if this problem was already solved, if there are known gotchas, or if a previous session left relevant learnings. Search with multiple queries if needed — try exact terms, likely key names (e.g. "deployment-gotchas-{date}"), and broader descriptions. Never assume "no memory exists" after one failed search.

3. DURING WORK: Use search_context for patterns and history. Use query_graph to understand entity relationships. Use create_pipeline_task to delegate work to agents on GKE (API cost).

4. CRITICAL — LOCAL TASK EXECUTION: When the user says "run locally", "run this locally", "do this in the background", "background task", or "local task", you MUST call the run_task_locally MCP tool. Do NOT do the work yourself. The tool spawns a separate background Claude Code process in an isolated git worktree. This frees the current session for other work. NEVER interpret "run locally" as an instruction to do the work in this session — ALWAYS delegate via the tool.

5. BEFORE SESSION ENDS: Call write_memory with key "session-summary/{repo}/{date}" summarizing decisions, corrections, and non-obvious learnings. Call write_episode with raw session observations for passive fact extraction.`;

// Always replace — strip ALL old Lore prompts and write fresh
if (settings.systemPromptSuffix) {
  // Remove all Lore-injected blocks (may be stacked from multiple installs)
  settings.systemPromptSuffix = settings.systemPromptSuffix
    .replace(/\n*IMPORTANT: You have (access to )?the Lore MCP server[\s\S]*?(?=\n\n[A-Z]|\n*$)/g, '')
    .replace(/\n*You have access to the Lore MCP server[\s\S]*?(?=\n\n[A-Z]|\n*$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
settings.systemPromptSuffix = (settings.systemPromptSuffix || "") + lorePrompt;

// Session summary reminder on stop
if (!hasHook(settings.hooks, "Stop", "session-summary")) {
  if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];
  settings.hooks.Stop.push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command:
          "echo '[lore] Save session learnings: call write_memory with a summary of decisions, patterns, and corrections from this session.'",
      },
    ],
  });
}

// Auto-episode: capture session summary on stop via API
// The MCP server dumps ~/.lore/last-session.json on exit with tool call stats.
// This hook reads it and POSTs to /api/session-summary for fact extraction.
if (!hasHook(settings.hooks, "Stop", "session-summary")) {
  settings.hooks.Stop.push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command:
          `LORE_URL=\${LORE_API_URL:-}; LORE_TOKEN=\${LORE_INGEST_TOKEN:-}; SESSION_FILE=~/.lore/last-session.json; AGENT_ID=$(cat ~/.lore/agent-id 2>/dev/null || echo 'unknown'); REPO=$(git remote get-url origin 2>/dev/null | sed 's|.*github.com[:/]||;s|\\.git$||' || echo 'unknown'); if [ -n "$LORE_URL" ] && [ -n "$LORE_TOKEN" ] && [ -f "$SESSION_FILE" ]; then SESSION_LOG=$(cat "$SESSION_FILE"); curl -s -X POST "$LORE_URL/api/session-summary" -H "Authorization: Bearer $LORE_TOKEN" -H "Content-Type: application/json" -d "{\\"session_log\\":$SESSION_LOG,\\"repo\\":\\"$REPO\\",\\"agent_id\\":\\"$AGENT_ID\\"}" >/dev/null 2>&1 && echo '[lore] Session summary captured' || true; rm -f "$SESSION_FILE" 2>/dev/null; fi`,
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
