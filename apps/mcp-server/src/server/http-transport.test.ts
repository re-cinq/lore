import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { readJsonBody } from "./http-transport.js";

const bodyReq = (data: string | Buffer): IncomingMessage =>
  Readable.from([Buffer.from(data)]) as unknown as IncomingMessage;

describe("readJsonBody", () => {
  it("parses a JSON object body", async () => {
    expect(await readJsonBody(bodyReq('{"a":1}'))).toEqual({ a: 1 });
  });

  it("returns undefined for an empty body", async () => {
    expect(await readJsonBody(bodyReq(""))).toBeUndefined();
  });

  it("throws 400 when the body is not valid JSON", async () => {
    await expect(readJsonBody(bodyReq("{not json"))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("throws 413 when the body exceeds 1 MB", async () => {
    const tooBig = Buffer.alloc(1024 * 1024 + 1, 0x61);

    await expect(readJsonBody(bodyReq(tooBig))).rejects.toMatchObject({
      status: 413,
    });
  });
});
