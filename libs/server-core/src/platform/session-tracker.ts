/** In-memory log of MCP tool calls; dumps to ~/.lore/last-session.json for passive memory capture. */

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

/** Formats this process's live session log; the pure formatter below is the testable half. */
export function formatSessionSummary(): string {
  return formatSessionSummaryFromLog(sessionLog, sessionStartTime);
}

/** Formats any session log as a human-readable summary (pure formatting, no LLM). */
export function formatSessionSummaryFromLog(
  log: ToolCallEntry[],
  startTime: string,
): string {
  if (log.length === 0) {
    return "";
  }

  const now = new Date();
  const start = new Date(startTime);
  const durationMin = Math.round((now.getTime() - start.getTime()) / 60000);

  // Count calls per tool
  const toolCounts: Record<
    string,
    { calls: number; errors: number; totalMs: number }
  > = {};

  for (const entry of log) {
    if (!toolCounts[entry.tool]) {
      toolCounts[entry.tool] = { calls: 0, errors: 0, totalMs: 0 };
    }
    toolCounts[entry.tool].calls++;
    toolCounts[entry.tool].totalMs += entry.durationMs;

    if (!entry.success) {
      toolCounts[entry.tool].errors++;
    }
  }

  const totalCalls = log.length;
  const totalErrors = log.filter((e) => !e.success).length;

  const lines: string[] = [
    `Session: ${durationMin}min, ${totalCalls} tool calls, ${totalErrors} errors`,
    "",
    "Tool usage:",
  ];

  // Sort by call count descending
  const sorted = Object.entries(toolCounts).sort(
    (a, b) => b[1].calls - a[1].calls,
  );

  for (const [tool, stats] of sorted) {
    const avgMs = Math.round(stats.totalMs / stats.calls);
    const errSuffix = stats.errors > 0 ? ` (${stats.errors} errors)` : "";

    lines.push(`  ${tool}: ${stats.calls}x, avg ${avgMs}ms${errSuffix}`);
  }

  return lines.join("\n");
}

/** Writes session log to JSON file on process exit. */
export function dumpSessionLog(filePath?: string): void {
  if (sessionLog.length === 0) {
    return;
  }

  const targetPath = filePath || join(homedir(), ".lore", "last-session.json");

  try {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(
      targetPath,
      JSON.stringify(
        {
          startTime: sessionStartTime,
          endTime: new Date().toISOString(),
          summary: formatSessionSummary(),
          toolCalls: sessionLog.length,
          log: sessionLog,
        },
        null,
        2,
      ),
    );
  } catch {
    // Best effort — don't crash on exit
  }
}
