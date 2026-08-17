import { describe, it, expect } from "vitest";
import { rawBody, rawBytes } from "./raw-body.js";

describe("rawBody", () => {
  it("decodes a Buffer payload as utf-8", () => {
    expect(rawBody({ payload: Buffer.from("hello", "utf8") })).toBe("hello");
  });

  it("passes a string payload through", () => {
    expect(rawBody({ payload: "hello" })).toBe("hello");
  });

  it("returns empty for a parsed-object or absent payload", () => {
    expect(rawBody({ payload: { parsed: true } })).toBe("");
    expect(rawBody({})).toBe("");
  });
});

describe("rawBytes", () => {
  it("returns a Buffer payload unchanged, byte for byte", () => {
    // The reason this function exists: a gzip archive round-tripped through
    // rawBody's utf-8 decode comes back with U+FFFD where every invalid sequence
    // was, and the corruption is silent.
    const gzipMagic = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xfe]);

    expect(rawBytes({ payload: gzipMagic })).toBe(gzipMagic);
    expect(Buffer.from(rawBody({ payload: gzipMagic }), "utf8")).not.toEqual(
      gzipMagic,
    );
  });

  it("encodes a string payload as utf-8 bytes", () => {
    expect(rawBytes({ payload: "hi" })).toEqual(Buffer.from("hi", "utf8"));
  });

  it("returns an empty buffer when there is no payload", () => {
    expect(rawBytes({})).toEqual(Buffer.alloc(0));
  });
});
