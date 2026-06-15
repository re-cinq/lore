/**
 * Session tracker — in-memory log of MCP tool calls during a session.
 *
 * Captures tool name, duration, and success/failure for each tool call.
 * On process exit, dumps the log to ~/.lore/last-session.json so the
 * Stop hook can POST it to /api/session-summary for LLM summarization.
 *
 * This enables passive memory capture without agent cooperation.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ── Types ───────────────────────────────────────────────────────────

export interface ToolCallEntry {
  tool: string;
  timestamp: string;
  durationMs: number;
  success: boolean;
}

// ── State ───────────────────────────────────────────────────────────

const MAX_ENTRIES = 500;
const sessionLog: ToolCallEntry[] = [];
const sessionStartTime = new Date().toISOString();

// ── Public API ──────────────────────────────────────────────────────

export function trackToolCall(
  tool: string,
  durationMs: number,
  success: boolean,
): void {
  if (sessionLog.length >= MAX_ENTRIES) {
    sessionLog.shift(); // ring buffer behavior
  }
  sessionLog.push({
    tool,
    timestamp: new Date().toISOString(),
    durationMs,
    success,
  });
}

export function getSessionLog(): ToolCallEntry[] {
  return [...sessionLog];
}

export function getSessionStartTime(): string {
  return sessionStartTime;
}

/**
 * Format the session log as a human-readable summary.
 * Pure formatting — no LLM needed.
 */
export function formatSessionSummary(): string {
  if (sessionLog.length === 0) return "";

  const now = new Date();
  const start = new Date(sessionStartTime);
  const durationMin = Math.round((now.getTime() - start.getTime()) / 60000);

  // Count calls per tool
  const toolCounts: Record<string, { calls: number; errors: number; totalMs: number }> = {};
  for (const entry of sessionLog) {
    if (!toolCounts[entry.tool]) {
      toolCounts[entry.tool] = { calls: 0, errors: 0, totalMs: 0 };
    }
    toolCounts[entry.tool].calls++;
    toolCounts[entry.tool].totalMs += entry.durationMs;
    if (!entry.success) toolCounts[entry.tool].errors++;
  }

  const totalCalls = sessionLog.length;
  const totalErrors = sessionLog.filter((e) => !e.success).length;

  const lines: string[] = [
    `Session: ${durationMin}min, ${totalCalls} tool calls, ${totalErrors} errors`,
    "",
    "Tool usage:",
  ];

  // Sort by call count descending
  const sorted = Object.entries(toolCounts).sort((a, b) => b[1].calls - a[1].calls);
  for (const [tool, stats] of sorted) {
    const avgMs = Math.round(stats.totalMs / stats.calls);
    const errSuffix = stats.errors > 0 ? ` (${stats.errors} errors)` : "";
    lines.push(`  ${tool}: ${stats.calls}x, avg ${avgMs}ms${errSuffix}`);
  }

  return lines.join("\n");
}

/**
 * Write the session log to a JSON file (called on process exit).
 */
export function dumpSessionLog(filePath?: string): void {
  if (sessionLog.length === 0) return;

  const targetPath = filePath || join(homedir(), ".lore", "last-session.json");
  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, JSON.stringify({
      startTime: sessionStartTime,
      endTime: new Date().toISOString(),
      summary: formatSessionSummary(),
      toolCalls: sessionLog.length,
      log: sessionLog,
    }, null, 2));
  } catch {
    // Best effort — don't crash on exit
  }
}
