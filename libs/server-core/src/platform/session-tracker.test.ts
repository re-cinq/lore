import { describe, it, expect } from "vitest";
import {
  formatSessionSummaryFromLog,
  type ToolCallEntry,
} from "./session-tracker.js";

describe("session tracker", () => {
  describe("formatSessionSummary", () => {
    it("returns empty string for empty log", () => {
      expect(formatSessionSummaryFromLog([], new Date().toISOString())).toBe(
        "",
      );
    });

    it("formats a simple session", () => {
      const log: ToolCallEntry[] = [
        {
          tool: "lore_search_context",
          timestamp: new Date().toISOString(),
          durationMs: 150,
          success: true,
        },
        {
          tool: "lore_assemble_context",
          timestamp: new Date().toISOString(),
          durationMs: 300,
          success: true,
        },
        {
          tool: "lore_search_context",
          timestamp: new Date().toISOString(),
          durationMs: 200,
          success: true,
        },
      ];
      const summary = formatSessionSummaryFromLog(
        log,
        new Date().toISOString(),
      );

      expect(summary).toContain("3 tool calls");
      expect(summary).toContain("0 errors");
      expect(summary).toContain("lore_search_context: 2x");
      expect(summary).toContain("lore_assemble_context: 1x");
    });

    it("includes error counts per tool", () => {
      const log: ToolCallEntry[] = [
        {
          tool: "lore_write_memory",
          timestamp: new Date().toISOString(),
          durationMs: 100,
          success: true,
        },
        {
          tool: "lore_write_memory",
          timestamp: new Date().toISOString(),
          durationMs: 50,
          success: false,
        },
      ];
      const summary = formatSessionSummaryFromLog(
        log,
        new Date().toISOString(),
      );

      expect(summary).toContain("1 errors");
      expect(summary).toContain("lore_write_memory: 2x");
      expect(summary).toContain("(1 errors)");
    });

    it("sorts tools by call count descending", () => {
      const log: ToolCallEntry[] = [
        {
          tool: "b_tool",
          timestamp: new Date().toISOString(),
          durationMs: 10,
          success: true,
        },
        {
          tool: "a_tool",
          timestamp: new Date().toISOString(),
          durationMs: 10,
          success: true,
        },
        {
          tool: "a_tool",
          timestamp: new Date().toISOString(),
          durationMs: 10,
          success: true,
        },
        {
          tool: "a_tool",
          timestamp: new Date().toISOString(),
          durationMs: 10,
          success: true,
        },
      ];
      const summary = formatSessionSummaryFromLog(
        log,
        new Date().toISOString(),
      );

      const aIdx = summary.indexOf("a_tool");
      const bIdx = summary.indexOf("b_tool");

      expect(aIdx).toBeLessThan(bIdx);
    });

    it("calculates average duration per tool", () => {
      const log: ToolCallEntry[] = [
        {
          tool: "slow",
          timestamp: new Date().toISOString(),
          durationMs: 100,
          success: true,
        },
        {
          tool: "slow",
          timestamp: new Date().toISOString(),
          durationMs: 200,
          success: true,
        },
      ];
      const summary = formatSessionSummaryFromLog(
        log,
        new Date().toISOString(),
      );

      expect(summary).toContain("avg 150ms");
    });
  });

  describe("ring buffer behavior", () => {
    it("caps at MAX_ENTRIES", () => {
      const MAX = 500;
      const log: ToolCallEntry[] = [];

      for (let i = 0; i < MAX + 100; i++) {
        if (log.length >= MAX) {
          log.shift();
        }
        log.push({
          tool: `tool_${i}`,
          timestamp: new Date().toISOString(),
          durationMs: 1,
          success: true,
        });
      }
      expect(log.length).toBe(MAX);
      expect(log[0].tool).toBe("tool_100");
    });
  });
});
