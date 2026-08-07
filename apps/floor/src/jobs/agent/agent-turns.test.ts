import { describe, it, expect } from "vitest";
import { turnFromEnvelope, turnStoreEnabled } from "./agent-turns.js";
import { parseAgentSink } from "./agent-events.js";

const envelope = (event: unknown, task = "task-9") => ({
  source: { task, agent: "abc123def456-review", pod: "p" },
  event,
});

describe("turnFromEnvelope", () => {
  it("keeps one untruncated turn per stream line with the line's own type", () => {
    const bigText = "the quick brown fox jumps over the lazy dog. ".repeat(500);
    const turn = turnFromEnvelope(
      envelope({
        type: "assistant",
        message: { content: [{ type: "text", text: bigText }] },
      }),
    );

    expect(turn).toMatchObject({
      taskId: "task-9",
      agentCrName: "abc123def456-review",
      eventType: "assistant",
    });
    const content = turn?.payload.message as {
      content: Array<{ text: string }>;
    };

    expect(content.content[0].text).toBe(bigText);
  });

  it("runs the secret-redaction path over the payload before it is stored", () => {
    const turn = turnFromEnvelope(
      envelope({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              content:
                "export GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz12",
            },
          ],
        },
      }),
    );

    expect(JSON.stringify(turn?.payload)).not.toContain(
      "ghp_0123456789abcdefghijklmnopqrstuvwxyz12",
    );
    expect(JSON.stringify(turn?.payload)).toContain("REDACTED");
  });

  it("drops a task-less line and an unknown line kind", () => {
    expect(turnFromEnvelope(envelope({ type: "assistant" }, ""))).toBeNull();
    expect(turnFromEnvelope(envelope({ type: "mystery_kind" }))).toBeNull();
  });
});

describe("turnStoreEnabled", () => {
  it("is off by default and on only when the flag opts in", () => {
    expect(turnStoreEnabled(undefined)).toBe(false);
    expect(turnStoreEnabled("")).toBe(false);
    expect(turnStoreEnabled("false")).toBe(false);
    expect(turnStoreEnabled("1")).toBe(true);
    expect(turnStoreEnabled("true")).toBe(true);
  });
});

describe("parseAgentSink turn projection", () => {
  const body = [
    JSON.stringify(envelope({ type: "system", subtype: "init", model: "m" })),
    JSON.stringify(
      envelope({
        type: "assistant",
        message: { content: [{ type: "text", text: "hi" }] },
      }),
    ),
    "not json",
    JSON.stringify(envelope({ type: "result", is_error: false, usage: {} })),
  ].join("\n");

  it("collects one turn per attributed line at the same tee as the projection", () => {
    const { turnRows } = parseAgentSink(body, true, true);

    expect(turnRows.map((t) => t.eventType)).toEqual([
      "system",
      "assistant",
      "result",
    ]);
  });

  it("collects no turns unless the tee asks for them", () => {
    expect(parseAgentSink(body, true).turnRows).toEqual([]);
    expect(parseAgentSink(body, true, false).turnRows).toEqual([]);
  });
});
