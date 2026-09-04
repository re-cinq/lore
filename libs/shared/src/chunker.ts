/** AST-based code chunking via web-tree-sitter: code files split per top-level declaration, docs/spec/ADR on `##` headings, else a sliding window (400 lines, 50-line overlap). */

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

/** Bumped whenever chunking output shape changes, so the nightly reindex can spot and re-ingest files chunked by an older chunker. */
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

/** Node types that represent top-level declarations, per grammar (TS/TSX share one set, as do JS/JSX). */
const TS_DECLARATIONS = new Set([
  "function_declaration",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "export_statement",
  "lexical_declaration",
  "variable_declaration",
  // Top-level calls like describe(...) — vitest test bodies were dropped from ingestion without this (#995).
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

/** A single chunk spanning the whole file — the shared fallback when a chunker finds no internal boundaries. */
function wholeFileChunk(
  content: string,
  extra?: Partial<Chunk["metadata"]>,
): Chunk[] {
  return [{ content, metadata: { chunk_index: 0, ...extra } }];
}

/** Line count of the file's real content — a trailing newline terminates the last line rather than opening a phantom empty one. */
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

/** Ordered rule table for `inferSymbolType`: first matching predicate wins. */
const SYMBOL_TYPE_RULES: [(nodeType: string) => boolean, string][] = [
  [(t) => t.includes("function") || t === "method_declaration", "function"],
  [(t) => t.includes("class"), "class"],
  [(t) => t.includes("method"), "method"],
  [(t) => t.includes("interface"), "interface"],
  [(t) => t.includes("type_alias") || t === "type_declaration", "type"],
  [(t) => t.includes("enum"), "type"],
  [(t) => t === "export_statement", "export"],
  // decorated_definition could be a class too, refined by refineSymbolType.
  [(t) => t === "decorated_definition", "function"],
];

function inferSymbolType(nodeType: string): string {
  const rule = SYMBOL_TYPE_RULES.find(([matches]) => matches(nodeType));

  return rule ? rule[1] : "export";
}

/** Base identifier of a possibly chained or curried callee — `describe` in `describe.each([...])('title', …)`. */
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

/** Test-runner macros whose first string argument names the block — the one call family whose title is a meaningful symbol name. */
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

/** Name a test-macro call after its first string argument, or any other call after its plain-identifier/member-chain callee path; undefined otherwise (IIFEs). */
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

function isTestMacroRoot(root: string | undefined): root is string {
  return root !== undefined && TEST_CALL_ROOTS.has(root);
}

/** Plain-identifier or member-chain callee text (e.g. `foo` or `foo.bar`); undefined for anything else, including IIFEs. */
function plainCalleeText(callee: Parser.SyntaxNode | null): string | undefined {
  const isPlainCallee =
    callee?.type === "identifier" || callee?.type === "member_expression";

  return isPlainCallee ? callee.text : undefined;
}

function callSymbolName(call: Parser.SyntaxNode): string | undefined {
  const callee = call.childForFieldName("function");
  const root = rootCalleeName(callee);
  const title = isTestMacroRoot(root) ? testCallTitle(call) : undefined;

  return title ?? plainCalleeText(callee);
}

interface SymbolInfo {
  name?: string;
  type?: string;
}

/** Symbol metadata for a top-level node: a statement wrapping a call gets `type: "call"`; other expression statements carry no symbol fields. */
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

/** Unwraps an `export_statement` to its declaration or a `decorated_definition` to its wrapped function/class; undefined for any other node. */
function innerDeclarationNode(
  node: Parser.SyntaxNode,
): Parser.SyntaxNode | undefined {
  if (node.type === "export_statement") {
    return node.childForFieldName("declaration") ?? node.namedChildren[0];
  }

  if (node.type === "decorated_definition") {
    return node.namedChildren.find(
      (c) => c.type === "function_definition" || c.type === "class_definition",
    );
  }

  return undefined;
}

function extractSymbolName(node: Parser.SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName("name");

  if (nameNode) {
    return nameNode.text;
  }

  const inner = innerDeclarationNode(node);

  return inner ? extractSymbolName(inner) : undefined;
}

function refineSymbolType(node: Parser.SyntaxNode, initial: string): string {
  const inner = innerDeclarationNode(node);

  return inner ? inferSymbolType(inner.type) : initial;
}

// ── AST-based chunking ──────────────────────────────────────────────

/** Prefixes marking a comment or docstring line, across the slash-comment and Python-docstring styles this chunker sees. */
const COMMENT_LINE_PREFIXES = ["//", "/*", "*", "#", '"""', "'''"];

function isCommentOrBlankLine(line: string): boolean {
  return (
    line === "" ||
    COMMENT_LINE_PREFIXES.some((prefix) => line.startsWith(prefix))
  );
}

/** First line of the comment/docstring block leading a declaration, trimmed of leading blanks; the declaration's own start row when none. */
function leadingCommentStart(
  lines: string[],
  declStartRow: number,
  prevEnd: number,
): number {
  let startLine = declStartRow;

  for (let row = declStartRow - 1; row >= prevEnd; row--) {
    if (!isCommentOrBlankLine(lines[row].trim())) {
      break;
    }
    startLine = row;
  }

  while (startLine < declStartRow && lines[startLine].trim() === "") {
    startLine++;
  }

  return startLine;
}

interface DeclInfo {
  node: Parser.SyntaxNode;
  startRow: number;
  endRow: number;
}

/** Top-level declaration nodes matching this extension's declaration types, in source order. */
function collectTopLevelDecls(
  root: Parser.SyntaxNode,
  declTypes: Set<string>,
): DeclInfo[] {
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

  return decls;
}

/** Chunk for everything before the first declaration (imports, comments, etc.); null when there is none. */
function preambleChunk(lines: string[], firstDeclStart: number): Chunk | null {
  const preamble =
    firstDeclStart > 0
      ? lines.slice(0, firstDeclStart).join("\n").trimEnd()
      : "";

  if (preamble.length === 0) {
    return null;
  }

  return {
    content: preamble,
    metadata: { chunk_index: 0, start_line: 1, end_line: firstDeclStart },
  };
}

/** Chunk for one declaration, including its leading comments. */
function declChunk(
  lines: string[],
  decl: DeclInfo,
  prevEnd: number,
  chunkIndex: number,
): Chunk {
  const startLine = leadingCommentStart(lines, decl.startRow, prevEnd);
  const chunkContent = lines.slice(startLine, decl.endRow + 1).join("\n");
  const symbol = symbolInfo(decl.node);

  return {
    content: chunkContent,
    metadata: {
      symbol_name: symbol.name,
      symbol_type: symbol.type,
      start_line: startLine + 1,
      end_line: decl.endRow + 1,
      chunk_index: chunkIndex,
    },
  };
}

function chunkCodeAST(
  tree: Parser.Tree,
  content: string,
  ext: string,
): Chunk[] {
  const lines = content.split("\n");
  const declTypes = DECLARATION_TYPES[ext] ?? new Set<string>();
  const decls = collectTopLevelDecls(tree.rootNode, declTypes);

  if (decls.length === 0) {
    return wholeFileChunk(content, {
      start_line: 1,
      end_line: lineCount(content),
    });
  }

  const firstDeclStart = decls[0].startRow;
  const preamble = preambleChunk(lines, firstDeclStart);
  const chunks: Chunk[] = preamble ? [preamble] : [];
  let chunkIndex = chunks.length;

  for (let i = 0; i < decls.length; i++) {
    const prevEnd = i > 0 ? decls[i - 1].endRow + 1 : firstDeclStart;

    chunks.push(declChunk(lines, decls[i], prevEnd, chunkIndex++));
  }

  return chunks;
}

// ── Markdown heading-based chunking ─────────────────────────────────

interface HeadingMatch {
  title: string;
  index: number;
}

function findMarkdownHeadings(content: string): HeadingMatch[] {
  const headingRe = /^## .+$/gm;
  const matches: HeadingMatch[] = [];

  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(content)) !== null) {
    matches.push({ title: match[0].replace(/^## /, ""), index: match.index });
  }

  return matches;
}

/** Chunk for the text spanning one `##` heading through the next (or end of file). */
function markdownSectionChunk(
  content: string,
  matches: HeadingMatch[],
  i: number,
  chunkIndex: number,
): Chunk {
  const start = matches[i].index;
  const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
  const section = content.slice(start, end).trimEnd();

  return {
    content: section,
    metadata: { section_title: matches[i].title, chunk_index: chunkIndex },
  };
}

function chunkMarkdown(content: string): Chunk[] {
  const matches = findMarkdownHeadings(content);

  if (matches.length === 0) {
    return wholeFileChunk(content);
  }

  // Content before the first ## heading
  const preamble =
    matches[0].index > 0 ? content.slice(0, matches[0].index).trimEnd() : "";
  const chunks: Chunk[] =
    preamble.length > 0
      ? [{ content: preamble, metadata: { chunk_index: 0 } }]
      : [];
  let chunkIndex = chunks.length;

  for (let i = 0; i < matches.length; i++) {
    chunks.push(markdownSectionChunk(content, matches, i, chunkIndex++));
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
        start_line: start + 1,
        end_line: end,
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

/** Stamps each chunk with the sha256 of its own content, applied at the single `chunkFile` chokepoint so every chunking path yields hashed chunks. */
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

/** Builds the JSONB `metadata` payload persisted with a chunk at ingest, so both ingest paths persist the same shape. `commit` is included only when supplied. */
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
