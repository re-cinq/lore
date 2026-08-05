import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  trackToolCall,
  dumpSessionLog,
  getSessionLog,
} from "./session-tracker.js";

// Exercises the REAL session-tracker exports, so `sessionLog` is module-shared
// state that persists across tests in this file. We never assume the buffer is
// empty: the dump test segregates by a unique tool-name prefix and filters, and
// the ring-buffer test pushes >MAX_ENTRIES fresh entries so any prior rows are
// shifted out — both assertions hold regardless of test order or leftover state.

interface DumpedSession {
  startTime: string;
  endTime: string;
  summary: string;
  toolCalls: number;
  log: {
    tool: string;
    timestamp: string;
    durationMs: number;
    success: boolean;
  }[];
}

describe("session-tracker dump + ring buffer", () => {
  it("writes tracked calls into the dumped json log", () => {
    trackToolCall("dump_probe_alpha", 120, true);
    trackToolCall("dump_probe_beta", 80, false);
    trackToolCall("dump_probe_alpha", 200, true);

    const target = join(
      tmpdir(),
      `lore-session-dump-${process.pid}-${Date.now()}.json`,
    );

    dumpSessionLog(target);

    const dumped = JSON.parse(readFileSync(target, "utf8")) as DumpedSession;
    const probes = dumped.log.filter((entry) =>
      entry.tool.startsWith("dump_probe_"),
    );

    expect(dumped.toolCalls).toBe(dumped.log.length);
    expect(probes).toMatchObject([
      { tool: "dump_probe_alpha", durationMs: 120, success: true },
      { tool: "dump_probe_beta", durationMs: 80, success: false },
      { tool: "dump_probe_alpha", durationMs: 200, success: true },
    ]);
  });

  it("caps the ring buffer at 500 entries dropping the oldest", () => {
    for (let i = 0; i < 600; i++) {
      trackToolCall(`ring_${i}`, 1, true);
    }

    const log = getSessionLog();

    expect(log).toHaveLength(500);
    expect(log[0].tool).toBe("ring_100");
    expect(log[499].tool).toBe("ring_599");
  });
});
