import { describe, it, expect } from "vitest";
import { chunkFile } from "./chunker.js";

describe("T206: Add tree-sitter grammar support", () => {
  it("extracts symbols using the optional Rust tree-sitter grammar", async () => {
    const source = [
      "pub fn greet(name: &str) -> String {",
      '    format!("hi {}", name)',
      "}",
    ].join("\n");

    const chunks = await chunkFile(source, "greet.rs", "code");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata).toMatchObject({
      symbol_name: "greet",
      symbol_type: "function",
    });
  });
});
