import { describe, it, expect } from "vitest";
import { stripFence, parseModelJson } from "./model-json.js";

describe("stripFence", () => {
  it("returns the inner body of a ```json fence", () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("returns the inner body of a bare ``` fence", () => {
    expect(stripFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("returns the trimmed text unchanged when there is no fence", () => {
    expect(stripFence('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe("parseModelJson", () => {
  it("parses a ```json-fenced object", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses an unfenced object", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws a contextual error naming the snippet on malformed JSON", () => {
    expect(() => parseModelJson("not json {")).toThrow(
      /feature-planning: model returned non-JSON — not json \{/,
    );
  });

  it("truncates the snippet to the first 200 characters", () => {
    const long = `${"x".repeat(500)}`;

    try {
      parseModelJson(long);
      throw new Error("expected parseModelJson to throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      expect(message).toContain("x".repeat(200));
      expect(message).not.toContain("x".repeat(201));
    }
  });
});
