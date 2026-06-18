import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { chunkFile, buildIngestedChunkMetadata } from "./chunker.js";

describe("chunkFile code AST chunking", () => {
  it("splits TypeScript imports into a preamble chunk and each declaration into its own chunk", async () => {
    const source = [
      "import { a } from './a.js';",
      "import { b } from './b.js';",
      "",
      "export function greet(name: string): string {",
      "  return `hi ${name}`;",
      "}",
      "",
      "export class Greeter {",
      "  hello() { return 'hi'; }",
      "}",
    ].join("\n");

    const chunks = await chunkFile(source, "greet.ts", "code");

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({
      content: "import { a } from './a.js';\nimport { b } from './b.js';",
      metadata: { chunk_index: 0, start_line: 1, end_line: 3 },
    });
    expect(chunks[1].metadata).toMatchObject({
      symbol_name: "greet",
      symbol_type: "function",
      chunk_index: 1,
    });
    expect(chunks[2].metadata).toMatchObject({
      symbol_name: "Greeter",
      symbol_type: "class",
      chunk_index: 2,
    });
  });

  it("attaches a leading comment block to the second declaration's chunk", async () => {
    const source = [
      "export function first(): void {}",
      "",
      "// describes the second one",
      "export function second(): number {",
      "  return 42;",
      "}",
    ].join("\n");

    const chunks = await chunkFile(source, "two.ts", "code");
    const secondChunk = chunks.find((c) => c.metadata.symbol_name === "second");

    expect(secondChunk?.content).toContain("// describes the second one");
    expect(secondChunk?.metadata).toMatchObject({ symbol_type: "function" });
  });

  it("emits a comment before the first declaration as its own preamble chunk", async () => {
    const source = [
      "// the answer to everything",
      "export function answer(): number {",
      "  return 42;",
      "}",
    ].join("\n");

    const chunks = await chunkFile(source, "answer.ts", "code");

    expect(chunks[0]).toMatchObject({
      content: "// the answer to everything",
      metadata: { chunk_index: 0, start_line: 1, end_line: 1 },
    });
    expect(chunks[1].metadata).toMatchObject({ symbol_name: "answer", symbol_type: "function" });
  });

  it("refines an exported interface to interface and an exported type alias to type", async () => {
    const source = [
      "export interface Shape {",
      "  sides: number;",
      "}",
      "export type Id = string;",
    ].join("\n");

    const chunks = await chunkFile(source, "shape.ts", "code");

    expect(chunks[0].metadata).toMatchObject({ symbol_name: "Shape", symbol_type: "interface" });
    expect(chunks[1].metadata).toMatchObject({ symbol_name: "Id", symbol_type: "type" });
  });

  it("extracts the wrapped name and type from a Python decorated definition", async () => {
    const source = [
      "@app.route('/')",
      "def index():",
      "    return 'home'",
    ].join("\n");

    const [chunk] = await chunkFile(source, "views.py", "code");

    expect(chunk.metadata).toMatchObject({ symbol_name: "index", symbol_type: "function" });
  });

  it("types a Go method_declaration as function", async () => {
    const source = [
      "package main",
      "",
      "func (s *Server) Start() error {",
      "\treturn nil",
      "}",
    ].join("\n");

    const chunks = await chunkFile(source, "server.go", "code");
    const method = chunks.find((c) => c.metadata.symbol_name === "Start");

    expect(method?.metadata.symbol_type).toBe("function");
  });

  it("returns the whole file as one chunk when the code has no top-level declarations", async () => {
    const source = "console.log('side effect only');\n";

    const chunks = await chunkFile(source, "script.ts", "code");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(source);
  });
});

describe("chunkFile unsupported and sliding-window fallback", () => {
  it("returns a single whole-file chunk for an unsupported language under the window size", async () => {
    const source = "puts 'hello from ruby'\n";

    const chunks = await chunkFile(source, "hello.rb", "code");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata).toMatchObject({ chunk_index: 0, start_line: 1, end_line: 2 });
  });

  it("splits an unsupported language over 400 lines into overlapping windows", async () => {
    const source = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join("\n");

    const chunks = await chunkFile(source, "big.rb", "code");

    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata).toMatchObject({ chunk_index: 0, start_line: 1, end_line: 400 });
    expect(chunks[1].metadata).toMatchObject({ chunk_index: 1, start_line: 351, end_line: 450 });
  });
});

describe("chunkFile markdown heading chunking", () => {
  it("splits a preamble and each ## section into its own titled chunk", async () => {
    const source = [
      "intro paragraph",
      "",
      "## First",
      "first body",
      "",
      "## Second",
      "second body",
    ].join("\n");

    const chunks = await chunkFile(source, "doc.md", "doc");

    expect(chunks).toHaveLength(3);
    expect(chunks[0].content).toBe("intro paragraph");
    expect(chunks[1].metadata.section_title).toBe("First");
    expect(chunks[2].metadata.section_title).toBe("Second");
  });
});

describe("chunkFile", () => {
  it("stamps content_hash equal to sha256 of the chunk's own content", async () => {
    const markdown = "Lore tracks every chunk by hash.";

    const chunks = await chunkFile(markdown, "notes.md", "doc");
    const chunk = chunks[0];

    const expectedHash = createHash("sha256").update(chunk.content).digest("hex");

    expect(chunk.metadata.content_hash).toBe(expectedHash);
  });
});

describe("buildIngestedChunkMetadata", () => {
  it("carries content_hash, file_path, and ingested_by from an api ingest", async () => {
    const [chunk] = await chunkFile("Persisted by the api.", "notes.md", "doc");

    const meta = buildIngestedChunkMetadata(chunk, {
      filePath: "notes.md",
      ingestedBy: "api",
      commit: "abc123",
    });

    expect(meta).toMatchObject({
      content_hash: chunk.metadata.content_hash,
      file_path: "notes.md",
      ingested_by: "api",
      commit: "abc123",
    });
  });

  it("omits commit when not provided for a reindex-job ingest", async () => {
    const [chunk] = await chunkFile("Persisted by reindex.", "notes.md", "doc");

    const meta = buildIngestedChunkMetadata(chunk, {
      filePath: "notes.md",
      ingestedBy: "reindex-job",
    });

    expect(meta).toMatchObject({
      content_hash: chunk.metadata.content_hash,
      file_path: "notes.md",
      ingested_by: "reindex-job",
    });
    expect("commit" in meta).toBe(false);
  });
});
