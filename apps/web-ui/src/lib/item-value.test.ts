import { describe, it, expect } from "vitest";
import { itemValueOf } from "./item-value";

const HASH = `sha256-${"ab12".repeat(16)}`;

describe("itemValueOf", () => {
  it("decodes sections, a list of JSON strings, into slot and text objects", () => {
    const sections = JSON.stringify([
      JSON.stringify({ slot: "*", text: "## repair\n\nFix it.\n" }),
    ]);

    expect(itemValueOf(sections, "run-1")).toEqual({
      kind: "json",
      value: [{ slot: "*", text: "## repair\n\nFix it.\n" }],
    });
  });

  it("keeps [draft text that does not parse as text", () => {
    expect(itemValueOf("[draft] fix login", "run-1")).toEqual({
      kind: "text",
      text: "[draft] fix login",
    });
  });

  it("keeps a JSON string nested six deep as a string past depth 5", () => {
    let nested = JSON.stringify({ leaf: true });

    for (let depth = 0; depth < 6; depth += 1) {
      nested = JSON.stringify([nested]);
    }
    const decoded = itemValueOf(nested, "run-1");
    let level: unknown = decoded.kind === "json" ? decoded.value : null;

    for (let depth = 0; depth < 5; depth += 1) {
      level = (level as unknown[])[0];
    }

    expect(typeof (level as unknown[])[0]).toBe("string");
  });

  it("names a sha256 hash a blob", () => {
    expect(itemValueOf(HASH, "run-1")).toEqual({ kind: "blob", hash: HASH });
  });

  it("links a pull request URL", () => {
    expect(
      itemValueOf("https://github.com/re-cinq/lore/pull/1", "run-1"),
    ).toEqual({
      kind: "link",
      href: "https://github.com/re-cinq/lore/pull/1",
      external: true,
    });
  });

  it("keeps task-1 as text", () => {
    expect(itemValueOf("task-1", "run-1")).toEqual({
      kind: "text",
      text: "task-1",
    });
  });

  it("keeps a bare JSON number 42 as text", () => {
    expect(itemValueOf("42", "run-1")).toEqual({ kind: "text", text: "42" });
  });
});
