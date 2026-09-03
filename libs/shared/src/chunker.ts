/**
 * AST-based code chunking using web-tree-sitter.
 *
 * Splits file content into meaningful chunks:
 * - Code files: parsed via tree-sitter, each top-level declaration becomes a chunk
 * - Doc/spec/ADR files: split on ## heading boundaries
 * - Fallback: sliding-window (400 lines, 50-line overlap)
 */

import Parser from "web-tree-sitter";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { join, extname } from "node:path";

export interface Chunk {
  content: string;
  metadata: {
    symbol_name?: string;
    symbol_type?: string; // 'function' | 'class' | 'method' | 'interface' | 'type' | 'export' | 'call'
    start_line?: number;
    end_line?: number;
    section_title?: string;
    chunk_index: number;
    content_hash?: string;
  };
}

/** Bumped whenever chunking output changes shape for existing content, so the
 * nightly reindex can spot files chunked by an older chunker and re-ingest
 * them. v2: top-level expression statements (describe blocks) become chunks
 * and every code chunk carries start_line/end_line. */
export const CHUNKER_VERSION = 2;

// ── Lazy parser + grammar cache ──────────────────────────────────────

let parserReady: Promise<void> | null = null;
let parser: Parser | null = null;
const grammarCache = new Map<string, Parser.Language>();

const require = createRequire(import.meta.url);

/** Map file extensions to tree-sitter-wasms grammar file names. */
const EXT_TO_GRAMMAR: Record<string, string> = {
  ".ts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-tsx.wasm",
  ".js": "tree-sitter-javascript.wasm",
  ".jsx": "tree-sitter-javascript.wasm",
  ".py": "tree-sitter-python.wasm",
  ".go": "tree-sitter-go.wasm",
};

/** Node types that represent top-level declarations, per grammar.
 * TS/TSX share one set, as do JS/JSX — defined once and aliased. */
const TS_DECLARATIONS = new Set([
  "function_declaration",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "export_statement",
  "lexical_declaration",
  "variable_declaration",
  // Top-level calls like describe(...) — without this, vitest test bodies
  // are dropped from ingestion entirely (issue #995).
  "expression_statement",
]);
const JS_DECLARATIONS = new Set([
  "function_declaration",
  "class_declaration",
  "export_statement",
  "lexical_declaration",
  "variable_declaration",
  "expression_statement",
]);
const DECLARATION_TYPES: Record<string, Set<string>> = {
  ".ts": TS_DECLARATIONS,
  ".tsx": TS_DECLARATIONS,
  ".js": JS_DECLARATIONS,
  ".jsx": JS_DECLARATIONS,
  ".py": new Set([
    "function_definition",
    "class_definition",
    "decorated_definition",
  ]),
  ".go": new Set([
    "function_declaration",
    "method_declaration",
    "type_declaration",
    "var_declaration",
    "const_declaration",
  ]),
};

/** A single chunk spanning the whole file — the shared fallback when a
 * chunker finds no internal boundaries (no declarations, no headings,
 * a short file, or an AST parse failure). */
function wholeFileChunk(
  content: string,
  extra?: Partial<Chunk["metadata"]>,
): Chunk[] {
  return [{ content, metadata: { chunk_index: 0, ...extra } }];
}

/** Line count of the file's real content — a trailing newline terminates the
 * last line rather than opening a phantom empty one. */
function lineCount(content: string): number {
  return content.replace(/\n$/, "").split("\n").length;
}

async function initParser(): Promise<void> {
  await Parser.init();
  parser = new Parser();
}

async function ensureParser(): Promise<Parser> {
  if (!parserReady) {
    parserReady = initParser();
  }
  await parserReady;

  return parser!;
}

async function loadGrammar(ext: string): Promise<Parser.Language | null> {
  const cached = grammarCache.get(ext);

  if (cached) {
    return cached;
  }

  const wasmFile = EXT_TO_GRAMMAR[ext];

  if (!wasmFile) {
    return null;
  }

  try {
    // tree-sitter-wasms ships .wasm files at its package root
    const wasmsDir = join(
      require.resolve("tree-sitter-wasms/package.json"),
      "..",
      "out",
    );
    const wasmPath = join(wasmsDir, wasmFile);
    const wasmBuf = await readFile(wasmPath);
    const lang = await Parser.Language.load(wasmBuf);

    grammarCache.set(ext, lang);

    return lang;
  } catch (err) {
    console.error(`[chunker] Failed to load grammar for ${ext}:`, err);

    return null;
  }
}

// ── Symbol extraction helpers ────────────────────────────────────────

function inferSymbolType(nodeType: string): string {
  if (nodeType.includes("function") || nodeType === "method_declaration") {
    return "function";
  }

  if (nodeType.includes("class")) {
    return "class";
  }

  if (nodeType.includes("method")) {
    return "method";
  }

  if (nodeType.includes("interface")) {
    return "interface";
  }

  if (nodeType.includes("type_alias") || nodeType === "type_declaration") {
    return "type";
  }

  if (nodeType.includes("enum")) {
    return "type";
  }

  if (nodeType === "export_statement") {
    return "export";
  }

  if (nodeType === "decorated_definition") {
    return "function";
  } // could be class too, refined below

  return "export";
}

/** Base identifier of a possibly chained or curried callee — `describe` in
 * `describe.each([...])('title', …)`. */
function rootCalleeName(callee: Parser.SyntaxNode | null): string | undefined {
  let node = callee;

  while (node) {
    if (node.type === "identifier") {
      return node.text;
    }

    if (node.type === "member_expression") {
      node = node.childForFieldName("object");
      continue;
    }

    if (node.type === "call_expression") {
      node = node.childForFieldName("function");
      continue;
    }

    return undefined;
  }

  return undefined;
}

/** Test-runner macros whose first string argument names the block — the one
 * call family whose title is a meaningful symbol name. Skipped/focused
 * variants (`xdescribe`, `fit`, …) are distinct identifiers; chained forms
 * (`describe.skip`, `test.only`, `describe.each`) already unwrap to the root. */
const TEST_CALL_ROOTS = new Set([
  "describe",
  "it",
  "test",
  "suite",
  "xdescribe",
  "xit",
  "xtest",
  "fdescribe",
  "fit",
  "ftest",
]);

/** Name a test-macro call after its first string argument
 * (`describe("PgTaskQueue", …)` → `PgTaskQueue`), with template-literal
 * interpolations stripped; any other call after its callee path when that is
 * a plain identifier or member chain (`console.log(…)` → `console.log`),
 * undefined otherwise (IIFEs). */
function testCallTitle(call: Parser.SyntaxNode): string | undefined {
  const args = call.childForFieldName("arguments");
  const firstString = args?.namedChildren.find(
    (a) => a.type === "string" || a.type === "template_string",
  );
  const title = firstString?.text
    .slice(1, -1)
    .replace(/\$\{[^}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return title !== undefined && title.length > 0 ? title : undefined;
}

function callSymbolName(call: Parser.SyntaxNode): string | undefined {
  const callee = call.childForFieldName("function");
  const root = rootCalleeName(callee);
  const isTestCall = root !== undefined && TEST_CALL_ROOTS.has(root);
  const title = isTestCall ? testCallTitle(call) : undefined;

  if (title !== undefined) {
    return title;
  }

  const isPlainCallee =
    callee?.type === "identifier" || callee?.type === "member_expression";

  return isPlainCallee ? callee.text : undefined;
}

interface SymbolInfo {
  name?: string;
  type?: string;
}

/** Symbol metadata for a top-level node. A statement wrapping a call gets
 * `type: "call"` + the call-derived name; other expression statements carry
 * no symbol fields (so they never enter the codeSymbols surface). */
function symbolInfo(node: Parser.SyntaxNode): SymbolInfo {
  if (node.type !== "expression_statement") {
    const rawType = inferSymbolType(node.type);

    return {
      name: extractSymbolName(node),
      type: refineSymbolType(node, rawType),
    };
  }

  const call = node.namedChildren.find((c) => c.type === "call_expression");

  if (!call) {
    return {};
  }

  return { name: callSymbolName(call), type: "call" };
}

function extractSymbolName(node: Parser.SyntaxNode): string | undefined {
  // Direct name child
  const nameNode = node.childForFieldName("name");

  if (nameNode) {
    return nameNode.text;
  }

  // export_statement wraps a declaration
  if (node.type === "export_statement") {
    const decl = node.childForFieldName("declaration") ?? node.namedChildren[0];

    return decl ? extractSymbolName(decl) : undefined;
  }

  // Python decorated_definition wraps a function_definition or class_definition
  if (node.type === "decorated_definition") {
    const def = node.namedChildren.find(
      (c) => c.type === "function_definition" || c.type === "class_definition",
    );

    return def ? extractSymbolName(def) : undefined;
  }

  return undefined;
}

function refineSymbolType(node: Parser.SyntaxNode, initial: string): string {
  if (node.type === "export_statement") {
    const decl = node.childForFieldName("declaration") ?? node.namedChildren[0];

    return decl ? inferSymbolType(decl.type) : initial;
  }

  if (node.type === "decorated_definition") {
    const def = node.namedChildren.find(
      (c) => c.type === "function_definition" || c.type === "class_definition",
    );

    return def ? inferSymbolType(def.type) : initial;
  }

  return initial;
}

// ── AST-based chunking ──────────────────────────────────────────────

/** First line of the comment/docstring block leading a declaration, with
 * leading blank lines trimmed; the declaration's own start row when none. */
function leadingCommentStart(
  lines: string[],
  declStartRow: number,
  prevEnd: number,
): number {
  let startLine = declStartRow;

  for (let row = declStartRow - 1; row >= prevEnd; row--) {
    const line = lines[row].trim();

    const isSlashComment =
      line.startsWith("//") || line.startsWith("/*") || line.startsWith("*");
    const isDocstring =
      line.startsWith("#") || line.startsWith('"""') || line.startsWith("'''");
    const isCommentOrBlank = isSlashComment || isDocstring || line === "";

    if (!isCommentOrBlank) {
      break;
    }
    startLine = row;
  }

  while (startLine < declStartRow && lines[startLine].trim() === "") {
    startLine++;
  }

  return startLine;
}

function chunkCodeAST(
  tree: Parser.Tree,
  content: string,
  ext: string,
): Chunk[] {
  const lines = content.split("\n");
  const declTypes = DECLARATION_TYPES[ext] ?? new Set<string>();
  const root = tree.rootNode;

  // Collect top-level declaration nodes
  interface DeclInfo {
    node: Parser.SyntaxNode;
    startRow: number;
    endRow: number;
  }
  const decls: DeclInfo[] = [];

  for (const child of root.namedChildren) {
    if (declTypes.has(child.type)) {
      decls.push({
        node: child,
        startRow: child.startPosition.row,
        endRow: child.endPosition.row,
      });
    }
  }

  if (decls.length === 0) {
    // No declarations found -- return whole file as one chunk
    return wholeFileChunk(content, {
      start_line: 1,
      end_line: lineCount(content),
    });
  }

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  // Preamble: everything before first declaration (imports, comments, etc.)
  const firstDeclStart = decls[0].startRow;
  const preamble =
    firstDeclStart > 0
      ? lines.slice(0, firstDeclStart).join("\n").trimEnd()
      : "";

  if (preamble.length > 0) {
    chunks.push({
      content: preamble,
      metadata: {
        chunk_index: chunkIndex++,
        start_line: 1,
        end_line: firstDeclStart,
      },
    });
  }

  // Each declaration becomes a chunk. Include leading comments.
  for (let i = 0; i < decls.length; i++) {
    const decl = decls[i];
    const prevEnd = i > 0 ? decls[i - 1].endRow + 1 : firstDeclStart;
    const startLine = leadingCommentStart(lines, decl.startRow, prevEnd);
    const chunkContent = lines.slice(startLine, decl.endRow + 1).join("\n");
    const symbol = symbolInfo(decl.node);

    chunks.push({
      content: chunkContent,
      metadata: {
        symbol_name: symbol.name,
        symbol_type: symbol.type,
        start_line: startLine + 1, // 1-based
        end_line: decl.endRow + 1, // 1-based
        chunk_index: chunkIndex++,
      },
    });
  }

  return chunks;
}

// ── Markdown heading-based chunking ─────────────────────────────────

function chunkMarkdown(content: string): Chunk[] {
  const headingRe = /^## .+$/gm;
  const matches: { title: string; index: number }[] = [];

  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(content)) !== null) {
    matches.push({ title: match[0].replace(/^## /, ""), index: match.index });
  }

  if (matches.length === 0) {
    return wholeFileChunk(content);
  }

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  // Content before first ## heading
  const preamble =
    matches[0].index > 0 ? content.slice(0, matches[0].index).trimEnd() : "";

  if (preamble.length > 0) {
    chunks.push({
      content: preamble,
      metadata: { chunk_index: chunkIndex++ },
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    const section = content.slice(start, end).trimEnd();

    chunks.push({
      content: section,
      metadata: {
        section_title: matches[i].title,
        chunk_index: chunkIndex++,
      },
    });
  }

  return chunks;
}

// ── Sliding-window fallback ─────────────────────────────────────────

function chunkSlidingWindow(content: string): Chunk[] {
  const lines = content.split("\n");
  const WINDOW = 400;
  const OVERLAP = 50;
  const chunks: Chunk[] = [];

  if (lines.length <= WINDOW) {
    return wholeFileChunk(content, { start_line: 1, end_line: lines.length });
  }

  let start = 0;
  let chunkIndex = 0;

  while (start < lines.length) {
    const end = Math.min(start + WINDOW, lines.length);

    chunks.push({
      content: lines.slice(start, end).join("\n"),
      metadata: {
        chunk_index: chunkIndex++,
        start_line: start + 1, // 1-based
        end_line: end, // 1-based
      },
    });

    if (end >= lines.length) {
      break;
    }
    start += WINDOW - OVERLAP;
  }

  return chunks;
}

// ── Content hashing ─────────────────────────────────────────────────

/**
 * Stamp each chunk with the sha256 of its own content.
 *
 * Applied at the single `chunkFile` chokepoint so every chunking path
 * (AST, markdown, sliding-window) yields hashed chunks without each
 * emit site repeating the hash logic. The hash is over `chunk.content`
 * only, so it is stable across re-ingest of identical content.
 */
function stampContentHash(chunks: Chunk[]): Chunk[] {
  for (const chunk of chunks) {
    chunk.metadata.content_hash = createHash("sha256")
      .update(chunk.content)
      .digest("hex");
  }

  return chunks;
}

// ── Public API ──────────────────────────────────────────────────────

export async function chunkFile(
  content: string,
  filePath: string,
  contentType: string,
): Promise<Chunk[]> {
  return stampContentHash(await chunkFileRaw(content, filePath, contentType));
}

/** Build the JSONB `metadata` payload persisted with a chunk at ingest.
 * Spreads the chunk's own metadata (carrying `content_hash`) and stamps the
 * ingest provenance, so both ingest paths persist the same shape. `commit`
 * is included only when supplied. */
export function buildIngestedChunkMetadata(
  chunk: Chunk,
  opts: { filePath: string; ingestedBy: string; commit?: string },
): Record<string, unknown> {
  return {
    ...chunk.metadata,
    file_path: opts.filePath,
    ingested_by: opts.ingestedBy,
    chunker_version: CHUNKER_VERSION,
    ...(opts.commit !== undefined ? { commit: opts.commit } : {}),
  };
}

async function chunkFileRaw(
  content: string,
  filePath: string,
  contentType: string,
): Promise<Chunk[]> {
  // Doc / spec / ADR files: split on ## headings
  if (contentType !== "code") {
    return chunkMarkdown(content);
  }

  // Code files: try AST-based chunking
  const ext = extname(filePath).toLowerCase();

  if (!EXT_TO_GRAMMAR[ext]) {
    // Unsupported language -- sliding window
    return chunkSlidingWindow(content);
  }

  try {
    const p = await ensureParser();
    const lang = await loadGrammar(ext);

    if (!lang) {
      return chunkSlidingWindow(content);
    }

    p.setLanguage(lang);
    const tree = p.parse(content);
    const chunks = chunkCodeAST(tree, content, ext);

    return chunks.length > 0
      ? chunks
      : wholeFileChunk(content, {
          start_line: 1,
          end_line: lineCount(content),
        });
  } catch (err) {
    console.error(
      `[chunker] AST parse failed for ${filePath}, falling back to sliding window:`,
      err,
    );

    return chunkSlidingWindow(content);
  }
}
