import { describe, it, expect } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { fakeLoreApi, specDescription } from "./shared/fake-lore-api.js";
import {
  GET_RUN_TRANSCRIPT_DESCRIPTION,
  registerGetRunTranscriptTool,
} from "./get-run-transcript.js";

const api = fakeLoreApi();
const getTranscript = toolHandlers(registerGetRunTranscriptTool, "agent")[
  "lore_get_run_transcript"
];
const textOf = async (args: Record<string, unknown>) =>
  (await getTranscript(args)).content[0].text;

describe("lore_get_run_transcript", () => {
  it("returns the first page of run r1's turns", async () => {
    api.answer("/api/assembly-runs/r1/turns", {
      turns: [{ id: "1" }],
      hasMore: true,
    });

    expect(JSON.parse(await textOf({ run_id: "r1" }))).toEqual({
      turns: [{ id: "1" }],
      hasMore: true,
    });
  });

  it("asks for 20 turns after turn 41", async () => {
    await textOf({ run_id: "r1", after: "41", limit: 20 });

    expect(api.requested).toEqual([
      "/api/assembly-runs/r1/turns?after=41&limit=20",
    ]);
  });

  it("reads visit v1's events when visit_id is v1", async () => {
    api.answer("/api/assembly-runs/r1/visits/v1/events", { events: [] });

    expect(JSON.parse(await textOf({ run_id: "r1", visit_id: "v1" }))).toEqual({
      events: [],
    });
  });

  it("carries the verbatim description block of specs/mcp-tools/get-run-transcript/spec.md", () => {
    expect(GET_RUN_TRANSCRIPT_DESCRIPTION).toBe(
      specDescription("get-run-transcript"),
    );
  });
});
