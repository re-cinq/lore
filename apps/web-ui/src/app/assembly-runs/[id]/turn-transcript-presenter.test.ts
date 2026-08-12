import { describe, it, expect } from "vitest";
import type { AgentRunTurn } from "@/lib/run-turn-types";
import {
  TURNS_PAGE_LIMIT,
  MAX_TURNS_LOADED,
  turnsUrl,
  nextTurnsCursor,
  turnsForNode,
  turnHeading,
  envelopePretty,
} from "./turn-transcript-presenter";

function turn(id: string, nodeId: string | null): AgentRunTurn {
  return {
    id,
    taskId: "task-1",
    agentCrName: nodeId === null ? null : `cr-${nodeId}`,
    assemblyLineId: "line-1",
    nodeId,
    iteration: nodeId === null ? null : 1,
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
      `/api/assembly-lines/run-1/turns?limit=${TURNS_PAGE_LIMIT}`,
    );
  });

  it("appends the cursor for a resumed page", () => {
    expect(turnsUrl("run-1", "42")).toBe(
      `/api/assembly-lines/run-1/turns?limit=${TURNS_PAGE_LIMIT}&after=42`,
    );
  });

  it("URL-encodes a hostile run id", () => {
    expect(turnsUrl("a/b?c", "0")).toBe(
      `/api/assembly-lines/a%2Fb%3Fc/turns?limit=${TURNS_PAGE_LIMIT}`,
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
