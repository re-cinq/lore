import { describe, it, expect } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  encodeServerMessage,
  LiveServerMessageSchema,
  parseClientMessage,
} from "./protocol.js";

describe("parseClientMessage", () => {
  it("reads a run open with its token and cursor", () => {
    expect(
      parseClientMessage(
        '{"type":"open","channel":"c1","kind":"run","subject":"run-1","token":"t","after":"42"}',
      ),
    ).toEqual({
      type: "open",
      channel: "c1",
      kind: "run",
      subject: "run-1",
      token: "t",
      after: "42",
    });
  });

  it("reads a plan open, a send and a close", () => {
    expect(
      parseClientMessage(
        '{"type":"open","channel":"p","kind":"plan","subject":"plan:o/r:1"}',
      ),
    ).toEqual({
      type: "open",
      channel: "p",
      kind: "plan",
      subject: "plan:o/r:1",
    });
    expect(
      parseClientMessage('{"type":"send","channel":"p","data":"AQI="}'),
    ).toEqual({ type: "send", channel: "p", data: "AQI=" });
    expect(parseClientMessage('{"type":"close","channel":"p"}')).toEqual({
      type: "close",
      channel: "p",
    });
  });

  it("reads an open of the runs channel and a watch of two run ids", () => {
    expect([
      parseClientMessage(
        JSON.stringify({
          type: "open",
          channel: "c1",
          kind: "runs",
          subject: "floor",
          token: "t-1",
        }),
      ),
      parseClientMessage(
        JSON.stringify({
          type: "watch",
          channel: "c1",
          runs: ["run-1", "run-2"],
        }),
      ),
    ]).toEqual([
      {
        type: "open",
        channel: "c1",
        kind: "runs",
        subject: "floor",
        token: "t-1",
      },
      { type: "watch", channel: "c1", runs: ["run-1", "run-2"] },
    ]);
  });

  it("reads a plan-run open of plan p1 with its token, and refuses one without a token", () => {
    const open = {
      type: "open",
      channel: "c2",
      kind: "plan-run",
      subject: "p1",
      token: "t-2",
    };

    expect([
      parseClientMessage(JSON.stringify(open)),
      parseClientMessage(JSON.stringify({ ...open, token: undefined })),
    ]).toEqual([open, null]);
  });

  it("reads a run open and a runs open with no token", () => {
    const run = { type: "open", channel: "c", kind: "run", subject: "run-1" };
    const runs = { type: "open", channel: "d", kind: "runs", subject: "floor" };

    expect(
      [run, runs].map((message) => parseClientMessage(JSON.stringify(message))),
    ).toEqual([run, runs]);
  });

  it("reads a request and rejects one whose path is outside /api/", () => {
    const request = {
      type: "request",
      id: "q1",
      method: "GET",
      path: "/api/floor-runs?limit=5",
    };

    expect(
      [
        request,
        { ...request, path: "/admin" },
        { ...request, method: "PATCH" },
      ].map((message) => parseClientMessage(JSON.stringify(message))),
    ).toEqual([request, null, null]);
  });

  it("returns null for non-JSON, an unknown type, a non-numeric cursor, and a plan-run open without a token", () => {
    expect(
      [
        "nope",
        '{"type":"dance","channel":"c"}',
        '{"type":"open","channel":"c","kind":"run","subject":"run-1","token":"t","after":"x"}',
        '{"type":"open","channel":"c","kind":"plan-run","subject":"p1"}',
      ].map(parseClientMessage),
    ).toEqual([null, null, null, null]);
  });
});

describe("server messages", () => {
  it("encodes every server message type as JSON the schema accepts back", () => {
    const messages = [
      { type: "opened", channel: "c" },
      {
        type: "frame",
        channel: "c",
        frame: { type: "catchup_complete", last_id: "3" },
      },
      { type: "plan_run", channel: "c", run: null },
      {
        type: "plan_run",
        channel: "c",
        run: {
          id: "run-1",
          status: "running",
          outcome: null,
          reason: null,
          issue_url: "https://github.com/o/r/issues/4",
          issue_number: 4,
          pr_url: "https://github.com/o/r/pull/7",
          pr_number: 7,
          pr_title: "Spec: checkout",
          pr_unresolved_threads: 2,
          spec_plan_summary: null,
        },
      },
      { type: "data", channel: "p", data: "AQI=" },
      { type: "closed", channel: "c", reason: "slow" },
      { type: "error", code: "bad_message" },
    ] as const;

    for (const message of messages) {
      expect(
        LiveServerMessageSchema.parse(JSON.parse(encodeServerMessage(message))),
      ).toEqual(message);
    }
  });

  it("round-trips bytes through base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);

    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
