import { describe, it, expect } from "vitest";
import { gapResultFromTurns } from "./recover-gap-result.js";

const write = (file_path: string, content: string) => ({
  event: {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", name: "Write", input: { file_path, content } },
      ],
    },
  },
});

const gap = { draft_spec_markdown: "# Spec", sections: [] };

describe("gapResultFromTurns", () => {
  it("returns the artifact the agent wrote at the watch path, parsed", () => {
    const turns = [
      { event: { type: "user", message: { role: "user", content: [] } } },
      write("/workspace/target/result.json", JSON.stringify(gap)),
      {
        event: {
          type: "assistant",
          message: { role: "assistant", content: "done" },
        },
      },
    ];

    expect(gapResultFromTurns(turns, "result.json")).toEqual(gap);
  });

  it("prefers the LAST write of the artifact — a self-correcting agent ships its final version", () => {
    const turns = [
      write(
        "/workspace/target/result.json",
        JSON.stringify({ draft_spec_markdown: "old" }),
      ),
      write("/workspace/target/result.json", JSON.stringify(gap)),
    ];

    expect(gapResultFromTurns(turns, "result.json")).toEqual(gap);
  });

  it("returns null for a transcript with no artifact write — a failed analysis stays failed", () => {
    const turns = [
      write("/workspace/target/notes.md", "not the artifact"),
      {
        event: {
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "gave up" }],
          },
        },
      },
    ];

    expect(gapResultFromTurns(turns, "result.json")).toBeNull();
  });

  it("skips a malformed later write and recovers the earlier valid one", () => {
    const turns = [
      write("/workspace/target/result.json", JSON.stringify(gap)),
      write("/workspace/target/result.json", "{not json"),
    ];

    expect(gapResultFromTurns(turns, "result.json")).toEqual(gap);
  });

  it("prefers the last write within a single message too", () => {
    const turns = [
      {
        event: {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                name: "Write",
                input: {
                  file_path: "/workspace/target/result.json",
                  content: JSON.stringify({ draft_spec_markdown: "old" }),
                },
              },
              {
                type: "tool_use",
                name: "Write",
                input: {
                  file_path: "/workspace/target/result.json",
                  content: JSON.stringify(gap),
                },
              },
            ],
          },
        },
      },
    ];

    expect(gapResultFromTurns(turns, "result.json")).toEqual(gap);
  });

  it("tolerates envelopes that are not turn-shaped at all", () => {
    expect(
      gapResultFromTurns([null, 42, {}, { event: {} }], "result.json"),
    ).toBeNull();
  });
});
