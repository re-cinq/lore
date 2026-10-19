import { describe, it, expect } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  decodeServerMessage,
  encodeClientMessage,
} from "./protocol";

describe("decodeServerMessage", () => {
  it("reads an opened, a frame, a data and a closed message on their channel", () => {
    expect(
      [
        '{"type":"opened","channel":"c1"}',
        '{"type":"frame","channel":"c1","frame":{"type":"catchup_complete","last_id":"3"}}',
        '{"type":"data","channel":"p","data":"AQI="}',
        '{"type":"closed","channel":"c1","reason":"slow"}',
      ].map(decodeServerMessage),
    ).toEqual([
      { type: "opened", channel: "c1" },
      {
        type: "frame",
        channel: "c1",
        frame: { type: "catchup_complete", last_id: "3" },
      },
      { type: "data", channel: "p", data: "AQI=" },
      { type: "closed", channel: "c1", reason: "slow" },
    ]);
  });

  it("reads a socket-level error with no channel", () => {
    expect(
      decodeServerMessage('{"type":"error","code":"bad_message"}'),
    ).toEqual({ type: "error", code: "bad_message" });
  });

  it("returns null for non-JSON, an unknown type, and a channel message without a channel", () => {
    expect(
      ["nope", '{"type":"dance","channel":"c1"}', '{"type":"opened"}'].map(
        decodeServerMessage,
      ),
    ).toEqual([null, null, null]);
  });
});

describe("client messages and bytes", () => {
  it("encodes a run open with its cursor as one JSON line", () => {
    expect(
      encodeClientMessage({
        type: "open",
        channel: "c1",
        kind: "run",
        subject: "run-1",
        token: "t",
        after: "42",
      }),
    ).toBe(
      '{"type":"open","channel":"c1","kind":"run","subject":"run-1","token":"t","after":"42"}',
    );
  });

  it("round-trips bytes through base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);

    expect({
      text: bytesToBase64(bytes),
      back: base64ToBytes("AAEC/w=="),
    }).toEqual({
      text: "AAEC/w==",
      back: bytes,
    });
  });
});
