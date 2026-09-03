import { describe, it, expect } from "vitest";
import type { AgentRunTurn } from "@/lib/run-turn-types";
import {
  TURNS_PAGE_LIMIT,
  MAX_TURNS_LOADED,
  MAX_WALK_PAGES,
  turnsUrl,
  nextTurnsCursor,
  parseHasMore,
  serverReportsMore,
  turnsForNode,
  turnHeading,
  envelopePretty,
  conversationEntries,
  clockTime,
} from "./turn-transcript-presenter";
import {
  HOOK_STARTED_SESSION,
  HOOK_STARTED_BOOTSTRAP,
  HOOK_RESPONSE_SESSION,
  HOOK_PROGRESS_BOOTSTRAP_FIRST,
  HOOK_PROGRESS_BOOTSTRAP_LAST,
  HOOK_RESPONSE_BOOTSTRAP,
  TOOL_PROGRESS_SKILL_FIRST,
  TOOL_PROGRESS_SKILL_LAST,
  GEMINI_ASSISTANT_DELTA_FIRST,
  GEMINI_ASSISTANT_DELTA_LAST,
} from "@/lib/agent-log-entries.fixtures";

function turn(id: string, nodeId: string | null): AgentRunTurn {
  return {
    id,
    taskId: "task-1",
    agentCrName: nodeId === null ? null : `cr-${nodeId}`,
    assemblyLineId: "line-1",
    nodeId,
    iteration: nodeId === null ? null : 1,
    stationRunId: null,
    eventType: "assistant",
    envelope: { event: { type: "assistant", id } },
    createdAt: "2026-08-12T10:00:00.000Z",
  };
}

function fullPage(): AgentRunTurn[] {
  return Array.from({ length: TURNS_PAGE_LIMIT }, (_, i) =>
    turn(String(i + 1), "implement"),
  );
}

describe("turnsUrl", () => {
  it("requests the run's turns proxy with the page limit", () => {
    expect(turnsUrl("run-1", "0")).toBe(
      `/api/assembly-runs/run-1/turns?limit=${TURNS_PAGE_LIMIT}`,
    );
  });

  it("appends the cursor for a resumed page", () => {
    expect(turnsUrl("run-1", "42")).toBe(
      `/api/assembly-runs/run-1/turns?limit=${TURNS_PAGE_LIMIT}&after=42`,
    );
  });

  it("URL-encodes a hostile run id", () => {
    expect(turnsUrl("a/b?c", "0")).toBe(
      `/api/assembly-runs/a%2Fb%3Fc/turns?limit=${TURNS_PAGE_LIMIT}`,
    );
  });
});

describe("nextTurnsCursor", () => {
  it("requests the maximum limit the Floor route accepts, not its default", () => {
    expect(TURNS_PAGE_LIMIT).toBe(5000);
  });

  it("bounds the whole walk to a finite number of pages", () => {
    expect(MAX_TURNS_LOADED / TURNS_PAGE_LIMIT).toBe(2);
  });

  it("stops paging on a short page", () => {
    expect(nextTurnsCursor([turn("1", "implement")])).toBeNull();
  });

  it("continues from the last id of a full page", () => {
    expect(nextTurnsCursor(fullPage())).toBe(String(TURNS_PAGE_LIMIT));
  });

  it("stops paging on an empty page", () => {
    expect(nextTurnsCursor([])).toBeNull();
  });

  it("continues from the last parseable id when a full page ends in a row without one", () => {
    const page: unknown[] = fullPage();

    page[TURNS_PAGE_LIMIT - 1] = { id: 7 };

    expect(nextTurnsCursor(page)).toBe(String(TURNS_PAGE_LIMIT - 1));
  });
});

describe("turnsForNode", () => {
  it("keeps only the selected node's turns", () => {
    const turns = [
      turn("1", "implement"),
      turn("2", "review"),
      turn("3", null),
    ];

    expect(turnsForNode(turns, "implement")).toEqual([turn("1", "implement")]);
  });
});

describe("turnHeading", () => {
  it("labels a turn by its raw event kind", () => {
    expect(turnHeading(turn("1", "implement"))).toBe("assistant");
  });

  it("labels a kind-less turn as unknown", () => {
    expect(turnHeading({ ...turn("1", "implement"), eventType: null })).toBe(
      "unknown",
    );
  });
});

describe("envelopePretty", () => {
  it("renders the untruncated envelope as indented JSON", () => {
    expect(envelopePretty(turn("7", "implement"))).toBe(
      JSON.stringify({ event: { type: "assistant", id: "7" } }, null, 2),
    );
  });
});

describe("nextTurnsCursor with the Floor's hasMore flag", () => {
  it("continues from the last id of a short page when hasMore is true", () => {
    expect(nextTurnsCursor([turn("1", "implement")], true)).toBe("1");
  });

  it("stops paging on a full page when hasMore is false", () => {
    expect(nextTurnsCursor(fullPage(), false)).toBeNull();
  });

  it("stops paging when hasMore is true but no row carries a string id", () => {
    expect(nextTurnsCursor([{ id: 7 }, {}], true)).toBeNull();
  });

  it("falls back to the short-page rule when the response carries no flag", () => {
    expect(nextTurnsCursor([turn("1", "implement")], undefined)).toBeNull();
    expect(nextTurnsCursor(fullPage(), undefined)).toBe(
      String(TURNS_PAGE_LIMIT),
    );
  });

  it("bounds one walk to 20 pages", () => {
    expect(MAX_WALK_PAGES).toBe(20);
  });
});

describe("parseHasMore", () => {
  it("returns the flag when it is a boolean", () => {
    expect(parseHasMore({ hasMore: true })).toBe(true);
    expect(parseHasMore({ hasMore: false })).toBe(false);
  });

  it("returns undefined for an absent flag", () => {
    expect(parseHasMore({})).toBeUndefined();
  });

  it("returns undefined for a malformed flag instead of trusting a truthy string", () => {
    expect(parseHasMore({ hasMore: "false" })).toBeUndefined();
    expect(parseHasMore({ hasMore: 1 })).toBeUndefined();
    expect(parseHasMore({ hasMore: null })).toBeUndefined();
  });
});

describe("serverReportsMore", () => {
  it("trusts the flag over page length in both directions", () => {
    expect(serverReportsMore([{}], true)).toBe(true);
    expect(serverReportsMore(fullPage(), false)).toBe(false);
  });

  it("falls back to page-length inference without a flag", () => {
    expect(serverReportsMore(fullPage(), undefined)).toBe(true);
    expect(serverReportsMore([{}], undefined)).toBe(false);
  });
});

function turnWithEnvelope(
  id: string,
  event: Record<string, unknown>,
  createdAt = "2026-08-12T10:00:00.000Z",
): AgentRunTurn {
  return {
    id,
    taskId: "task-1",
    agentCrName: "cr-implement",
    assemblyLineId: "line-1",
    nodeId: "implement",
    iteration: 1,
    stationRunId: null,
    eventType: "assistant",
    envelope: { source: { task: "task-1" }, event },
    createdAt,
  };
}

describe("conversationEntries", () => {
  it("tags each turn's entries with that turn's timestamp", () => {
    const turns = [
      turnWithEnvelope(
        "1",
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hello" }],
          },
        },
        "2026-08-12T10:00:01.000Z",
      ),
    ];

    expect(conversationEntries(turns)).toEqual([
      {
        at: "2026-08-12T10:00:01.000Z",
        entry: { kind: "assistant-text", text: "hello" },
      },
    ]);
  });

  it("renders a kind-less lifecycle turn as a sentence, not unknown", () => {
    const turns = [
      turnWithEnvelope("1", {
        kind: "lifecycle",
        phase: "init",
        status: "started",
      }),
    ];

    expect(conversationEntries(turns)).toEqual([
      {
        at: "2026-08-12T10:00:00.000Z",
        entry: { kind: "lifecycle", phase: "init", status: "started" },
      },
    ]);
  });

  it("synthesizes a raw entry for a turn that classifies to nothing", () => {
    const turns = [turnWithEnvelope("1", { type: "user" })];

    expect(conversationEntries(turns)).toEqual([
      {
        at: "2026-08-12T10:00:00.000Z",
        entry: { kind: "raw", text: JSON.stringify(turns[0].envelope) },
      },
    ]);
  });

  it("collapses a run of consecutive thinking-tokens turns into the last one", () => {
    const turns = [
      turnWithEnvelope(
        "1",
        { type: "system", subtype: "thinking_tokens", estimated_tokens: 11 },
        "2026-08-12T10:00:00.000Z",
      ),
      turnWithEnvelope(
        "2",
        { type: "system", subtype: "thinking_tokens", estimated_tokens: 21 },
        "2026-08-12T10:00:01.000Z",
      ),
    ];

    expect(conversationEntries(turns)).toEqual([
      {
        at: "2026-08-12T10:00:01.000Z",
        entry: { kind: "thinking-tokens", tokens: 21 },
      },
    ]);
  });

  it("returns no entries for no turns", () => {
    expect(conversationEntries([])).toEqual([]);
  });
});

describe("clockTime", () => {
  it("renders a plausible local time for an ISO timestamp", () => {
    expect(clockTime("2026-08-12T10:00:00.000Z")).toMatch(/\d{1,2}:\d{2}/);
  });

  it("is empty for an unparseable timestamp", () => {
    expect(clockTime("not-a-date")).toBe("");
  });
});

describe("conversationEntries — hook turns", () => {
  const hookTurn = (id: string, line: string, at: string) =>
    turnWithEnvelope(id, JSON.parse(line), at);

  it("folds a hook's cumulative turns onto the last turn's timestamp", () => {
    const entries = conversationEntries([
      hookTurn("1", HOOK_STARTED_BOOTSTRAP, "2026-08-28T11:19:08.000Z"),
      hookTurn("2", HOOK_PROGRESS_BOOTSTRAP_FIRST, "2026-08-28T11:19:09.000Z"),
      hookTurn("3", HOOK_PROGRESS_BOOTSTRAP_LAST, "2026-08-28T11:19:29.000Z"),
      hookTurn("4", HOOK_RESPONSE_BOOTSTRAP, "2026-08-28T11:19:31.000Z"),
    ]);

    expect(entries).toMatchObject({
      length: 1,
      0: {
        at: "2026-08-28T11:19:31.000Z",
        entry: { kind: "hook", phase: "response", outcome: "success" },
      },
    });
  });

  it("renders the run's six interleaved hook turns as four entries, none raw", () => {
    const entries = conversationEntries([
      hookTurn("1", HOOK_STARTED_SESSION, "2026-08-28T11:19:08.000Z"),
      hookTurn("2", HOOK_STARTED_BOOTSTRAP, "2026-08-28T11:19:08.000Z"),
      hookTurn("3", HOOK_RESPONSE_SESSION, "2026-08-28T11:19:08.000Z"),
      hookTurn("4", HOOK_PROGRESS_BOOTSTRAP_FIRST, "2026-08-28T11:19:09.000Z"),
      hookTurn("5", HOOK_PROGRESS_BOOTSTRAP_LAST, "2026-08-28T11:19:29.000Z"),
      hookTurn("6", HOOK_RESPONSE_BOOTSTRAP, "2026-08-28T11:19:31.000Z"),
    ]);

    expect(entries.map(({ entry }) => entry.kind)).toEqual([
      "hook",
      "hook",
      "hook",
      "hook",
    ]);
  });
});

describe("conversationEntries — tool progress turns", () => {
  const beat = (id: string, line: string, at: string) =>
    turnWithEnvelope(id, JSON.parse(line), at);

  it("folds a call's heartbeat turns onto the last turn's timestamp", () => {
    const entries = conversationEntries([
      beat("1", TOOL_PROGRESS_SKILL_FIRST, "2026-08-28T16:29:08.000Z"),
      beat("2", TOOL_PROGRESS_SKILL_LAST, "2026-08-28T16:38:38.000Z"),
    ]);

    expect(entries).toMatchObject({
      length: 1,
      0: {
        at: "2026-08-28T16:38:38.000Z",
        entry: {
          kind: "tool-progress",
          toolName: "Skill",
          elapsedSeconds: 600,
        },
      },
    });
  });
});

describe("conversationEntries — gemini delta turns", () => {
  const geminiTurn = (id: string, line: string, at: string) =>
    turnWithEnvelope(id, JSON.parse(line), at);

  it("merges delta chunk turns into one assistant-text on the first turn's timestamp", () => {
    const entries = conversationEntries([
      geminiTurn("1", GEMINI_ASSISTANT_DELTA_FIRST, "2026-09-02T07:10:02.000Z"),
      geminiTurn("2", GEMINI_ASSISTANT_DELTA_LAST, "2026-09-02T07:10:02.400Z"),
    ]);

    expect(entries).toEqual([
      {
        at: "2026-09-02T07:10:02.000Z",
        entry: {
          kind: "assistant-text",
          text: "The PR adds a traceability link to the Rollout section.",
          delta: true,
        },
      },
    ]);
  });
});
