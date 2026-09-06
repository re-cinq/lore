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

interface ToolStats {
  calls: number;
  errors: number;
  totalMs: number;
}

function tallyByTool(log: ToolCallEntry[]): Record<string, ToolStats> {
  const toolCounts: Record<string, ToolStats> = {};

  for (const entry of log) {
    const stats = (toolCounts[entry.tool] ??= {
      calls: 0,
      errors: 0,
      totalMs: 0,
    });

    stats.calls++;
    stats.totalMs += entry.durationMs;
    stats.errors += entry.success ? 0 : 1;
  }

  return toolCounts;
}

function formatToolLine(tool: string, stats: ToolStats): string {
  const avgMs = Math.round(stats.totalMs / stats.calls);
  const errSuffix = stats.errors > 0 ? ` (${stats.errors} errors)` : "";

  return `  ${tool}: ${stats.calls}x, avg ${avgMs}ms${errSuffix}`;
}

/** Formats any session log as a human-readable summary (pure formatting, no LLM). */
export function formatSessionSummaryFromLog(
  log: ToolCallEntry[],
  startTime: string,
): string {
  if (log.length === 0) {
    return "";
  }

  const durationMin = Math.round(
    (Date.now() - new Date(startTime).getTime()) / 60000,
  );
  const totalErrors = log.filter((e) => !e.success).length;

  const lines: string[] = [
    `Session: ${durationMin}min, ${log.length} tool calls, ${totalErrors} errors`,
    "",
    "Tool usage:",
  ];

  const sorted = Object.entries(tallyByTool(log)).sort(
    (a, b) => b[1].calls - a[1].calls,
  );

  for (const [tool, stats] of sorted) {
    lines.push(formatToolLine(tool, stats));
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
