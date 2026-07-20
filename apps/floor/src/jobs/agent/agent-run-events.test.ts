import { describe, it, expect } from "vitest";
import {
  parseAgentRunEvents,
  filePathsFromToolInput,
  truncateForStorage,
} from "./agent-run-events.js";
import { parseAgentEvents } from "./agent-events.js";

const SOURCE = { task: "task-uuid-1", agent: "abcd1234-review" };

const line = (event: unknown, source: unknown = SOURCE): string =>
  JSON.stringify({ source, event });

const assistant = (content: unknown[]): unknown => ({
  type: "assistant",
  message: { content },
});

const user = (content: unknown[]): unknown => ({
  type: "user",
  message: { content },
});

describe("parseAgentRunEvents", () => {
  it("maps a station result line with no usage field to a result row", () => {
    const rows = parseAgentRunEvents(
      line({
        type: "result",
        subtype: "success",
        is_error: false,
        result: 'LORE_NODE_RESULT: {"outcome":"success"}',
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: "task-uuid-1",
      agentCrName: "abcd1234-review",
      eventType: "result",
      isError: false,
    });
  });

  it("emits one row per assistant content block", () => {
    const rows = parseAgentRunEvents(
      line(
        assistant([
          { type: "text", text: "planning" },
          { type: "thinking", thinking: "weighing options" },
          { type: "tool_use", id: "tu-1", name: "Read", input: {} },
        ]),
      ),
    );

    expect(rows.map((r) => r.eventType)).toEqual([
      "message",
      "thinking",
      "tool_call",
    ]);
  });

  it("maps a text block to a message row with summary only and empty payload", () => {
    const rows = parseAgentRunEvents(
      line(assistant([{ type: "text", text: "planning the change" }])),
    );

    expect(rows[0]).toMatchObject({
      eventType: "message",
      summary: "planning the change",
      payload: {},
    });
  });

  it("maps a thinking block to a thinking row with summary only and empty payload", () => {
    const rows = parseAgentRunEvents(
      line(assistant([{ type: "thinking", thinking: "weighing options" }])),
    );

    expect(rows[0]).toMatchObject({
      eventType: "thinking",
      summary: "weighing options",
      payload: {},
    });
  });

  it("drops an assistant content block of an unrecognised type", () => {
    const rows = parseAgentRunEvents(
      line(assistant([{ type: "image", source: "..." }])),
    );

    expect(rows).toEqual([]);
  });

  it("maps a tool_use block to a tool_call row carrying toolName, toolUseId and extracted filePaths", () => {
    const rows = parseAgentRunEvents(
      line(
        assistant([
          {
            type: "tool_use",
            id: "tu-7",
            name: "Edit",
            input: { file_path: "src/foo.ts", old_string: "a" },
          },
        ]),
      ),
    );

    expect(rows[0]).toMatchObject({
      eventType: "tool_call",
      toolName: "Edit",
      toolUseId: "tu-7",
      filePaths: ["src/foo.ts"],
      summary: "Edit src/foo.ts",
      payload: { input: { file_path: "src/foo.ts", old_string: "a" } },
    });
  });

  it("returns empty filePaths for a Bash tool_use and summarises its command", () => {
    const rows = parseAgentRunEvents(
      line(
        assistant([
          {
            type: "tool_use",
            id: "tu-8",
            name: "Bash",
            input: { command: "rm -rf /tmp/x" },
          },
        ]),
      ),
    );

    expect(rows[0]).toMatchObject({
      filePaths: [],
      summary: "Bash rm -rf /tmp/x",
    });
  });

  it("summarises a tool_use with neither file path nor command as the tool name", () => {
    const rows = parseAgentRunEvents(
      line(assistant([{ type: "tool_use", id: "tu-9", name: "TodoWrite" }])),
    );

    expect(rows[0]).toMatchObject({ summary: "TodoWrite", filePaths: [] });
  });

  it("maps a tool_result block to a tool_result row with isError from the error flag", () => {
    const rows = parseAgentRunEvents(
      line(
        user([
          {
            type: "tool_result",
            tool_use_id: "tu-7",
            is_error: true,
            content: "boom",
          },
        ]),
      ),
    );

    expect(rows[0]).toMatchObject({
      eventType: "tool_result",
      toolUseId: "tu-7",
      isError: true,
      payload: { content: "boom" },
      summary: "tool_result error",
    });
  });

  it("maps a successful tool_result with array content to a joined payload", () => {
    const rows = parseAgentRunEvents(
      line(
        user([
          {
            type: "tool_result",
            tool_use_id: "tu-7",
            content: [{ type: "text", text: "ok then" }],
          },
        ]),
      ),
    );

    expect(rows[0]).toMatchObject({
      isError: false,
      summary: "tool_result ok",
      payload: { content: "ok then" },
    });
  });

  it("drops a user content block that is not a tool_result", () => {
    const rows = parseAgentRunEvents(
      line(user([{ type: "text", text: "hi" }])),
    );

    expect(rows).toEqual([]);
  });

  it("maps a system init line to an init row summarising model and tool count", () => {
    const rows = parseAgentRunEvents(
      line({
        type: "system",
        subtype: "init",
        model: "claude-opus-4",
        tools: ["Read", "Edit", "Bash"],
      }),
    );

    expect(rows[0]).toMatchObject({
      eventType: "init",
      summary: "init claude-opus-4 (3 tools)",
      payload: {},
    });
  });

  it("summarises an init line with no model or tools as unknown with zero tools", () => {
    const rows = parseAgentRunEvents(line({ type: "system", subtype: "init" }));

    expect(rows[0]).toMatchObject({ summary: "init unknown (0 tools)" });
  });

  it("drops a system line whose subtype is not init", () => {
    const rows = parseAgentRunEvents(
      line({ type: "system", subtype: "compact" }),
    );

    expect(rows).toEqual([]);
  });

  it("summarises a result line with its subtype, duration and cost", () => {
    const rows = parseAgentRunEvents(
      line({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1234,
        total_cost_usd: 0.0125,
      }),
    );

    expect(rows[0]).toMatchObject({
      eventType: "result",
      summary: "result success in 1234ms ($0.0125)",
      payload: { subtype: "success", durationMs: 1234, costUsd: 0.0125 },
    });
  });

  it("drops a line of an unrecognised type silently", () => {
    expect(parseAgentRunEvents(line({ type: "tomorrows_type" }))).toEqual([]);
  });

  it("drops an assistant line whose message content is not an array", () => {
    expect(
      parseAgentRunEvents(line({ type: "assistant", message: { content: 7 } })),
    ).toEqual([]);
  });

  it("drops a line whose unwrapped event is not an object", () => {
    expect(parseAgentRunEvents(line("just a string"))).toEqual([]);
  });

  it("drops an assistant content block that is not an object", () => {
    expect(parseAgentRunEvents(line(assistant(["oops", 7])))).toEqual([]);
  });

  it("drops a user content block that is not an object", () => {
    expect(parseAgentRunEvents(line(user(["oops"])))).toEqual([]);
  });

  it("stores empty content for a tool_result whose content is neither string nor array", () => {
    const rows = parseAgentRunEvents(
      line(user([{ type: "tool_result", tool_use_id: "t", content: 7 }])),
    );

    expect(rows[0].payload).toEqual({ content: "" });
  });

  it("ignores non-text blocks inside an array tool_result content", () => {
    const rows = parseAgentRunEvents(
      line(
        user([
          { type: "tool_result", tool_use_id: "t", content: ["raw", { a: 1 }] },
        ]),
      ),
    );

    expect(rows[0].payload).toEqual({ content: "" });
  });

  it("names an unnamed tool_use unknown and records a null toolUseId", () => {
    const rows = parseAgentRunEvents(
      line(assistant([{ type: "tool_use", input: {} }])),
    );

    expect(rows[0]).toMatchObject({
      toolName: "unknown",
      toolUseId: null,
      summary: "unknown",
    });
  });

  it("summarises a text block with no text as an empty summary", () => {
    const rows = parseAgentRunEvents(line(assistant([{ type: "text" }])));

    expect(rows[0].summary).toBe("");
  });

  it("summarises a thinking block with no thinking text as an empty summary", () => {
    const rows = parseAgentRunEvents(line(assistant([{ type: "thinking" }])));

    expect(rows[0].summary).toBe("");
  });

  it("keeps a non-string tool input value verbatim while budgeting its encoded size", () => {
    const rows = parseAgentRunEvents(
      line(
        assistant([
          {
            type: "tool_use",
            id: "t",
            name: "Edit",
            input: { replace_all: true, count: 3 },
          },
        ]),
      ),
    );

    expect(rows[0].payload?.input).toEqual({ replace_all: true, count: 3 });
  });

  it("budgets an unserialisable tool input value as empty", () => {
    const rows = parseAgentRunEvents(
      line(
        assistant([
          { type: "tool_use", id: "t", name: "Edit", input: { skip: null } },
        ]),
      ),
    );

    expect(rows[0].payload?.input).toEqual({ skip: null });
  });

  it("drops a tool_use whose input is not an object to an empty payload input", () => {
    const rows = parseAgentRunEvents(
      line(
        assistant([
          { type: "tool_use", id: "t", name: "Bash", input: "not an object" },
        ]),
      ),
    );

    expect(rows[0].payload).toEqual({ input: {} });
  });

  it("drops an assistant line carrying no message object", () => {
    expect(parseAgentRunEvents(line({ type: "assistant" }))).toEqual([]);
  });

  it("skips an unparseable line without throwing", () => {
    expect(parseAgentRunEvents("{not json\n")).toEqual([]);
  });

  it("skips blank lines", () => {
    expect(parseAgentRunEvents("\n  \n")).toEqual([]);
  });

  it("skips a line with no resolvable task id", () => {
    expect(
      parseAgentRunEvents(line({ type: "result" }, { agent: "a" })),
    ).toEqual([]);
  });

  it("records a null agentCrName when the envelope carries no agent", () => {
    const rows = parseAgentRunEvents(
      line({ type: "result" }, { task: "task-uuid-1" }),
    );

    expect(rows[0].agentCrName).toBeNull();
  });

  it("reads the event out of a double-wrapped attribution envelope", () => {
    const rows = parseAgentRunEvents(
      JSON.stringify({
        source: SOURCE,
        event: {
          source: SOURCE,
          event: { type: "result", subtype: "success" },
        },
      }),
    );

    expect(rows[0]).toMatchObject({
      taskId: "task-uuid-1",
      eventType: "result",
    });
  });

  it("truncates tool_result content at 2048 bytes and marks the truncation in the payload", () => {
    const rows = parseAgentRunEvents(
      line(
        user([
          { type: "tool_result", tool_use_id: "t", content: "x".repeat(5000) },
        ]),
      ),
    );
    const content = rows[0].payload?.content;

    expect(typeof content).toBe("string");
    expect(String(content)).toContain("[truncated");
    expect(String(content).startsWith("x".repeat(2048))).toBe(true);
  });

  it("truncates each tool input value at 1024 bytes", () => {
    const rows = parseAgentRunEvents(
      line(
        assistant([
          {
            type: "tool_use",
            id: "t",
            name: "Write",
            input: { content: "y".repeat(3000) },
          },
        ]),
      ),
    );
    const input = rows[0].payload?.input as Record<string, unknown>;

    expect(String(input.content)).toContain("[truncated");
    expect(String(input.content).startsWith("y".repeat(1024))).toBe(true);
  });

  it("drops trailing tool input keys once the whole input exceeds 4096 bytes", () => {
    const big = "z".repeat(1000);
    const rows = parseAgentRunEvents(
      line(
        assistant([
          {
            type: "tool_use",
            id: "t",
            name: "Write",
            input: { a: big, b: big, c: big, d: big, e: big, f: big },
          },
        ]),
      ),
    );
    const input = rows[0].payload?.input as Record<string, unknown>;

    expect(Object.keys(input)).toEqual(["a", "b", "c", "d", "__truncated__"]);
    expect(input.__truncated__).toBe("2 input keys omitted");
  });

  it("caps summary at 200 characters", () => {
    const rows = parseAgentRunEvents(
      line(assistant([{ type: "text", text: "w".repeat(500) }])),
    );

    expect(rows[0].summary).toHaveLength(200);
  });

  it("leaves parseAgentEvents cost rows unchanged for the same body", () => {
    const body = [
      line({ type: "system", subtype: "init", model: "m", tools: [] }),
      line(assistant([{ type: "text", text: "hi" }])),
      line({
        type: "result",
        subtype: "success",
        model: "claude-opus-4",
        usage: { input_tokens: 10, output_tokens: 2 },
        total_cost_usd: 0.5,
        duration_ms: 99,
      }),
    ].join("\n");

    expect(parseAgentEvents(body)).toEqual([
      {
        taskId: "task-uuid-1",
        model: "claude-opus-4",
        inputTokens: 10,
        outputTokens: 2,
        costUsd: 0.5,
        durationMs: 99,
      },
    ]);
    expect(parseAgentRunEvents(body)).toHaveLength(3);
  });
});

describe("filePathsFromToolInput", () => {
  it("reads file_path, path and notebook_path", () => {
    expect(
      filePathsFromToolInput({
        file_path: "a.ts",
        path: "b/",
        notebook_path: "c.ipynb",
      }),
    ).toEqual(["a.ts", "b/", "c.ipynb"]);
  });

  it("deduplicates repeated paths", () => {
    expect(filePathsFromToolInput({ file_path: "a.ts", path: "a.ts" })).toEqual(
      ["a.ts"],
    );
  });

  it("ignores non-string values", () => {
    expect(filePathsFromToolInput({ file_path: 7 })).toEqual([]);
  });

  it("returns empty for a non-object input", () => {
    expect(filePathsFromToolInput("nope")).toEqual([]);
  });
});

describe("truncateForStorage", () => {
  it("returns the text unchanged when it is within the byte cap", () => {
    expect(truncateForStorage("short", 100)).toBe("short");
  });

  it("counts bytes rather than characters for multibyte text", () => {
    expect(truncateForStorage("é".repeat(10), 10)).toContain("[truncated");
  });

  it("marks the original byte length in the truncation marker", () => {
    expect(truncateForStorage("x".repeat(50), 10)).toBe(
      `${"x".repeat(10)}…[truncated, 50 bytes]`,
    );
  });
});
