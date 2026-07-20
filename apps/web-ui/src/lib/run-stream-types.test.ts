import { describe, it, expect } from "vitest";
import {
  parseRunStreamEvent,
  parseRunStreamRow,
  type RunStreamEvent,
} from "./run-stream-types";

const wellFormed = {
  id: "42",
  taskId: "task-1",
  agentCrName: "abcd1234-implement",
  assemblyLineId: "line-1",
  nodeId: "implement",
  iteration: 1,
  eventType: "tool_call",
  toolName: "Edit",
  toolUseId: "toolu_1",
  isError: false,
  filePaths: ["src/a.ts"],
  summary: "edited a.ts",
  payload: { raw: "x" },
  createdAt: "2026-07-20T10:00:00.000Z",
};

describe("parseRunStreamEvent", () => {
  it("returns the row for a well-formed tool_call payload", () => {
    expect(parseRunStreamEvent(JSON.stringify(wellFormed))).toEqual(wellFormed);
  });

  it("returns createdAt as a string rather than a Date", () => {
    const parsed = parseRunStreamEvent(JSON.stringify(wellFormed));

    expect(parsed?.createdAt).toBe("2026-07-20T10:00:00.000Z");
  });

  it("returns null for malformed JSON", () => {
    expect(parseRunStreamEvent("{not json")).toBeNull();
  });

  it("returns null for an unknown eventType", () => {
    expect(
      parseRunStreamEvent(
        JSON.stringify({ ...wellFormed, eventType: "heartbeat" }),
      ),
    ).toBeNull();
  });

  it("returns null when eventType is absent", () => {
    const { eventType: _dropped, ...rest } = wellFormed;

    expect(parseRunStreamEvent(JSON.stringify(rest))).toBeNull();
  });

  it("returns null when id, taskId or createdAt is not a string", () => {
    expect(parseRunStreamEvent(JSON.stringify({ ...wellFormed, id: 42 }))).toBe(
      null,
    );
    expect(
      parseRunStreamEvent(JSON.stringify({ ...wellFormed, taskId: null })),
    ).toBeNull();
    expect(
      parseRunStreamEvent(JSON.stringify({ ...wellFormed, createdAt: 0 })),
    ).toBeNull();
  });

  it("defaults the optional correlation and payload fields", () => {
    const minimal = {
      id: "1",
      taskId: "t",
      eventType: "message" as const,
      createdAt: "2026-07-20T10:00:00.000Z",
    };

    expect(parseRunStreamEvent(JSON.stringify(minimal))).toEqual({
      ...minimal,
      agentCrName: null,
      assemblyLineId: null,
      nodeId: null,
      iteration: null,
      toolName: null,
      toolUseId: null,
      isError: false,
      filePaths: [],
      summary: null,
      payload: {},
    } satisfies RunStreamEvent);
  });

  it("drops non-string members of filePaths", () => {
    const parsed = parseRunStreamEvent(
      JSON.stringify({ ...wellFormed, filePaths: ["a.ts", 7, null, "b.ts"] }),
    );

    expect(parsed?.filePaths).toEqual(["a.ts", "b.ts"]);
  });

  it("returns null without throwing for every hostile input string", () => {
    const hostile = [
      "",
      "null",
      "true",
      "7",
      '"a string"',
      "[]",
      "[1,2,3]",
      "{}",
      '{"eventType":"init"}',
      '{"__proto__":{"a":1}}',
      "undefined",
      " ",
      "\u0000",
      '{"id":"1","taskId":"t","eventType":"init","createdAt":"x","filePaths":"nope"}',
    ];

    for (const raw of hostile) {
      expect(() => parseRunStreamEvent(raw)).not.toThrow();
    }

    expect(hostile.map(parseRunStreamEvent).filter(Boolean)).toEqual([
      {
        id: "1",
        taskId: "t",
        agentCrName: null,
        assemblyLineId: null,
        nodeId: null,
        iteration: null,
        eventType: "init",
        toolName: null,
        toolUseId: null,
        isError: false,
        filePaths: [],
        summary: null,
        payload: {},
        createdAt: "x",
      },
    ]);
  });
});

describe("parseRunStreamRow", () => {
  it("parses a decoded row object into a RunStreamEvent", () => {
    expect(parseRunStreamRow(wellFormed)).toEqual<RunStreamEvent>({
      ...wellFormed,
      eventType: "tool_call",
    });
  });

  it("returns null for a decoded row without id", () => {
    const { id: _id, ...withoutId } = wellFormed;

    expect(parseRunStreamRow(withoutId)).toBeNull();
  });

  it("returns null for a decoded row with an unknown eventType", () => {
    expect(
      parseRunStreamRow({ ...wellFormed, eventType: "telepathy" }),
    ).toBeNull();
  });

  it("returns null for a non-object row", () => {
    expect(parseRunStreamRow("not-an-object")).toBeNull();
  });
});
