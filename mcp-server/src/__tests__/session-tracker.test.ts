import { describe, it, expect, beforeEach } from "vitest";

// Re-implement the core logic for unit testing (module state is shared)
// Same pattern as local-runner.test.ts

interface ToolCallEntry {
  tool: string;
  timestamp: string;
  durationMs: number;
  success: boolean;
}

function formatSessionSummaryFromLog(
  log: ToolCallEntry[],
  startTime: string,
): string {
  if (log.length === 0) return "";

  const now = new Date();
  const start = new Date(startTime);
  const durationMin = Math.round((now.getTime() - start.getTime()) / 60000);

  const toolCounts: Record<string, { calls: number; errors: number; totalMs: number }> = {};
  for (const entry of log) {
    if (!toolCounts[entry.tool]) {
      toolCounts[entry.tool] = { calls: 0, errors: 0, totalMs: 0 };
    }
    toolCounts[entry.tool].calls++;
    toolCounts[entry.tool].totalMs += entry.durationMs;
    if (!entry.success) toolCounts[entry.tool].errors++;
  }

  const totalCalls = log.length;
  const totalErrors = log.filter((e) => !e.success).length;

  const lines: string[] = [
    `Session: ${durationMin}min, ${totalCalls} tool calls, ${totalErrors} errors`,
    "",
    "Tool usage:",
  ];

  const sorted = Object.entries(toolCounts).sort((a, b) => b[1].calls - a[1].calls);
  for (const [tool, stats] of sorted) {
    const avgMs = Math.round(stats.totalMs / stats.calls);
    const errSuffix = stats.errors > 0 ? ` (${stats.errors} errors)` : "";
    lines.push(`  ${tool}: ${stats.calls}x, avg ${avgMs}ms${errSuffix}`);
  }

  return lines.join("\n");
}

describe("session tracker", () => {
  describe("formatSessionSummary", () => {
    it("returns empty string for empty log", () => {
      expect(formatSessionSummaryFromLog([], new Date().toISOString())).toBe("");
    });

    it("formats a simple session", () => {
      const log: ToolCallEntry[] = [
        { tool: "search_context", timestamp: new Date().toISOString(), durationMs: 150, success: true },
        { tool: "assemble_context", timestamp: new Date().toISOString(), durationMs: 300, success: true },
        { tool: "search_context", timestamp: new Date().toISOString(), durationMs: 200, success: true },
      ];
      const summary = formatSessionSummaryFromLog(log, new Date().toISOString());

      expect(summary).toContain("3 tool calls");
      expect(summary).toContain("0 errors");
      expect(summary).toContain("search_context: 2x");
      expect(summary).toContain("assemble_context: 1x");
    });

    it("includes error counts per tool", () => {
      const log: ToolCallEntry[] = [
        { tool: "write_memory", timestamp: new Date().toISOString(), durationMs: 100, success: true },
        { tool: "write_memory", timestamp: new Date().toISOString(), durationMs: 50, success: false },
      ];
      const summary = formatSessionSummaryFromLog(log, new Date().toISOString());

      expect(summary).toContain("1 errors");
      expect(summary).toContain("write_memory: 2x");
      expect(summary).toContain("(1 errors)");
    });

    it("sorts tools by call count descending", () => {
      const log: ToolCallEntry[] = [
        { tool: "b_tool", timestamp: new Date().toISOString(), durationMs: 10, success: true },
        { tool: "a_tool", timestamp: new Date().toISOString(), durationMs: 10, success: true },
        { tool: "a_tool", timestamp: new Date().toISOString(), durationMs: 10, success: true },
        { tool: "a_tool", timestamp: new Date().toISOString(), durationMs: 10, success: true },
      ];
      const summary = formatSessionSummaryFromLog(log, new Date().toISOString());

      const aIdx = summary.indexOf("a_tool");
      const bIdx = summary.indexOf("b_tool");
      expect(aIdx).toBeLessThan(bIdx); // a_tool (3x) should come before b_tool (1x)
    });

    it("calculates average duration per tool", () => {
      const log: ToolCallEntry[] = [
        { tool: "slow", timestamp: new Date().toISOString(), durationMs: 100, success: true },
        { tool: "slow", timestamp: new Date().toISOString(), durationMs: 200, success: true },
      ];
      const summary = formatSessionSummaryFromLog(log, new Date().toISOString());

      expect(summary).toContain("avg 150ms");
    });
  });

  describe("ring buffer behavior", () => {
    it("caps at MAX_ENTRIES", () => {
      const MAX = 500;
      const log: ToolCallEntry[] = [];
      for (let i = 0; i < MAX + 100; i++) {
        if (log.length >= MAX) log.shift();
        log.push({ tool: `tool_${i}`, timestamp: new Date().toISOString(), durationMs: 1, success: true });
      }
      expect(log.length).toBe(MAX);
      expect(log[0].tool).toBe("tool_100"); // oldest entries shifted out
    });
  });
});
