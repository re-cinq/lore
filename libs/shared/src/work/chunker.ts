/** AST-based code chunking via web-tree-sitter: code files split per top-level declaration, docs/spec/ADR on `##` headings, else a sliding window (400 lines, 50-line overlap). */

import Parser from "web-tree-sitter";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { join, extname } from "node:path";
import { chunkCodeAST } from "./chunker-ast.js";
import { wholeFileChunk, lineCount, type Chunk } from "./chunk-primitives.js";

// Chunk shape + declaration-node-type table live in chunk-primitives.ts, re-exported for import-path back-compat.
export {
  type Chunk,
  DECLARATION_TYPES,
  wholeFileChunk,
  lineCount,
} from "./chunk-primitives.js";

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
