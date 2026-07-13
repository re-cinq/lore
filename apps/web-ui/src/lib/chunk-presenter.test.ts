import { describe, it, expect } from "vitest";
import { chunkHeader } from "./chunk-presenter";

describe("chunkHeader", () => {
  it("builds a code header from symbol type, name and line range", () => {
    expect(
      chunkHeader("code", {
        symbol_type: "function",
        symbol_name: "foo",
        start_line: 10,
        end_line: 42,
      }),
    ).toEqual("function foo · L10–42");
  });

  it("omits the line range when only the symbol is present", () => {
    expect(
      chunkHeader("code", { symbol_type: "class", symbol_name: "Foo" }),
    ).toEqual("class Foo");
  });

  it("shows only the line range when the symbol is absent", () => {
    expect(chunkHeader("code", { start_line: 5, end_line: 9 })).toEqual("L5–9");
  });

  it("shows a single line when only start_line is present", () => {
    expect(chunkHeader("code", { start_line: 5 })).toEqual("L5");
  });

  it("returns the section title for a doc chunk", () => {
    expect(chunkHeader("doc", { section_title: "Architecture" })).toEqual(
      "Architecture",
    );
  });

  it("returns empty string when there is no metadata", () => {
    expect(chunkHeader("code", null)).toEqual("");
    expect(chunkHeader("doc", undefined)).toEqual("");
  });

  it("returns empty string for a doc chunk with no section title", () => {
    expect(chunkHeader("doc", { chunk_index: 2 })).toEqual("");
  });
});
