// The turn-collection half of parseAgentSink (specs/turn-level-transcript-store
// FR3), kept out of agent-sink.test.ts because that file carries #L anchors
// from specs/assembly-line-run-viz that any insertion would silently shift.

import { describe, it, expect } from "vitest";
import { parseAgentSink } from "./agent-events.js";
import { MAX_RUN_TURNS_PER_BATCH } from "./agent-run-turns.js";

const src = { task: "task-uuid-1", agent: "cr-1" };
const line = (event: unknown): string => JSON.stringify({ source: src, event });
const assistant = (content: unknown[]): unknown => ({
  type: "assistant",
  message: { content },
});
const body = [
  line(assistant([{ type: "text", text: "hi" }])),
  line({ type: "result", subtype: "success", usage: { input_tokens: 10 } }),
].join("\n");

describe("parseAgentSink turn collection", () => {
  it("collects turns by default, since collection is unconditional", () => {
    expect(parseAgentSink(body).turns).toHaveLength(2);
  });

  it("collects nothing on the cost-only path, which opts out explicitly", () => {
    expect(parseAgentSink(body, false, false).turns).toEqual([]);
  });

  // The property the removed feature flag used to let an operator restore.
  // With collection unconditional there is no off switch in production, so this
  // is the only thing standing between the turn store and a regression in the
  // cost rows or the run-viz projection.
  it("leaves the cost rows and viz rows identical whether turns are collected or not", () => {
    const without = parseAgentSink(body, true, false);
    const with_ = parseAgentSink(body, true, true);

    expect(with_.costRows).toEqual(without.costRows);
    expect(with_.runEvents).toEqual(without.runEvents);
  });

  it("collects one turn per stream-json line in the same pass as the cost rows", () => {
    const sink = parseAgentSink(body, true, true);

    expect(sink.costRows).toHaveLength(1);
    expect(sink.turns.map((turn) => turn.eventType)).toEqual([
      "assistant",
      "result",
    ]);
  });

  it("collects the raw line verbatim, untruncated, as the turn envelope", () => {
    const sink = parseAgentSink(body, true, true);

    expect(sink.turns.map((turn) => turn.envelope)).toEqual(body.split("\n"));
  });

  it("collects a turn for a line the viz projection drops as an unknown kind", () => {
    const sink = parseAgentSink(line({ type: "brand_new_kind" }), true, true);

    expect(sink.runEvents).toEqual([]);
    expect(sink.turns).toHaveLength(1);
  });

  it("caps collected turns at MAX_RUN_TURNS_PER_BATCH", () => {
    const many = Array.from({ length: MAX_RUN_TURNS_PER_BATCH + 5 }, () =>
      line(assistant([{ type: "text", text: "x" }])),
    ).join("\n");

    expect(parseAgentSink(many, false, true).turns).toHaveLength(
      MAX_RUN_TURNS_PER_BATCH,
    );
  });
});

// A genuine (not stubbed) JSON-breaking redaction: the private-key pattern is
// not anchored inside one JSON string, so a BEGIN marker in a property NAME and
// an END marker in a later value collapse the structure between them. An agent
// can emit that pair deliberately, which is why the drop must be counted rather
// than silent — otherwise it is a self-censorship vector out of the transcript.
const REDACTION_BREAKING_LINE = JSON.stringify({
  source: src,
  event: {
    type: "assistant",
    "-----BEGIN PRIVATE KEY-----k": 1,
    z: "-----END PRIVATE KEY-----",
  },
});

describe("parseAgentSink dropped turns", () => {
  it("counts a turn dropped because redaction left its line unparseable", () => {
    const sink = parseAgentSink(REDACTION_BREAKING_LINE, false, true);

    expect(sink.turns).toEqual([]);
    expect(sink.turnsDropped).toBe(1);
  });

  it("keeps the other turns of a body when one line's redaction breaks it", () => {
    const mixed = [REDACTION_BREAKING_LINE, body].join("\n");

    const sink = parseAgentSink(mixed, false, true);

    expect(sink.turns).toHaveLength(2);
    expect(sink.turnsDropped).toBe(1);
  });

  it("counts nothing dropped for a body no redaction breaks", () => {
    expect(parseAgentSink(body, false, true).turnsDropped).toBe(0);
  });

  it("counts nothing dropped on the cost-only path", () => {
    expect(parseAgentSink(REDACTION_BREAKING_LINE, false, false)).toMatchObject(
      { turns: [], turnsDropped: 0 },
    );
  });
});

describe("parseAgentSink capped turns", () => {
  const overCap = (extra: number) =>
    Array.from({ length: MAX_RUN_TURNS_PER_BATCH + extra }, () =>
      line(assistant([{ type: "text", text: "x" }])),
    ).join("\n");

  it("counts every turn the per-batch cap left out", () => {
    const sink = parseAgentSink(overCap(5), false, true);

    expect(sink.turns).toHaveLength(MAX_RUN_TURNS_PER_BATCH);
    expect(sink.turnsCapped).toBe(5);
  });

  it("counts nothing capped for a body under the cap", () => {
    expect(parseAgentSink(body, false, true).turnsCapped).toBe(0);
  });

  it("counts nothing capped on the cost-only path", () => {
    expect(parseAgentSink(overCap(5), false, false).turnsCapped).toBe(0);
  });

  it("keeps counting redaction drops and cap drops apart", () => {
    const sink = parseAgentSink(
      [REDACTION_BREAKING_LINE, overCap(3)].join("\n"),
      false,
      true,
    );

    expect(sink).toMatchObject({ turnsDropped: 1, turnsCapped: 3 });
  });
});
