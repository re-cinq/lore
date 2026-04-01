/**
 * AST-based code chunking using web-tree-sitter.
 *
 * Splits file content into meaningful chunks:
 * - Code files: parsed via tree-sitter, each top-level declaration becomes a chunk
 * - Doc/spec/ADR files: split on ## heading boundaries
 * - Fallback: sliding-window (400 lines, 50-line overlap)
 *
 * NOTE: This is a copy of mcp-server/src/chunker.ts — keep them in sync
 * until a shared package is extracted.
 */

import Parser from 'web-tree-sitter';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, extname } from 'node:path';

export interface Chunk {
  content: string;
  metadata: {
    symbol_name?: string;
    symbol_type?: string; // 'function' | 'class' | 'method' | 'interface' | 'type' | 'export'
    start_line?: number;
    end_line?: number;
    section_title?: string;
    chunk_index: number;
  };
}

// ── Lazy parser + grammar cache ──────────────────────────────────────

let parserReady: Promise<void> | null = null;
let parser: Parser | null = null;
const grammarCache = new Map<string, Parser.Language>();

const require = createRequire(import.meta.url);

/** Map file extensions to tree-sitter-wasms grammar file names. */
const EXT_TO_GRAMMAR: Record<string, string> = {
  '.ts': 'tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-tsx.wasm',
  '.js': 'tree-sitter-javascript.wasm',
  '.jsx': 'tree-sitter-javascript.wasm',
  '.py': 'tree-sitter-python.wasm',
  '.go': 'tree-sitter-go.wasm',
};

/** Node types that represent top-level declarations, per grammar. */
const DECLARATION_TYPES: Record<string, Set<string>> = {
  '.ts': new Set([
    'function_declaration', 'class_declaration', 'interface_declaration',
    'type_alias_declaration', 'enum_declaration', 'export_statement',
    'lexical_declaration', 'variable_declaration',
  ]),
  '.tsx': new Set([
    'function_declaration', 'class_declaration', 'interface_declaration',
    'type_alias_declaration', 'enum_declaration', 'export_statement',
    'lexical_declaration', 'variable_declaration',
  ]),
  '.js': new Set([
    'function_declaration', 'class_declaration', 'export_statement',
    'lexical_declaration', 'variable_declaration',
  ]),
  '.jsx': new Set([
    'function_declaration', 'class_declaration', 'export_statement',
    'lexical_declaration', 'variable_declaration',
  ]),
  '.py': new Set([
    'function_definition', 'class_definition', 'decorated_definition',
  ]),
  '.go': new Set([
    'function_declaration', 'method_declaration', 'type_declaration',
    'var_declaration', 'const_declaration',
  ]),
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
  if (cached) return cached;

  const wasmFile = EXT_TO_GRAMMAR[ext];
  if (!wasmFile) return null;

  try {
    // tree-sitter-wasms ships .wasm files at its package root
    const wasmsDir = join(require.resolve('tree-sitter-wasms/package.json'), '..', 'out');
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
  if (nodeType.includes('function') || nodeType === 'method_declaration') return 'function';
  if (nodeType.includes('class')) return 'class';
  if (nodeType.includes('method')) return 'method';
  if (nodeType.includes('interface')) return 'interface';
  if (nodeType.includes('type_alias') || nodeType === 'type_declaration') return 'type';
  if (nodeType.includes('enum')) return 'type';
  if (nodeType === 'export_statement') return 'export';
  if (nodeType === 'decorated_definition') return 'function';
  return 'export';
}

function extractSymbolName(node: Parser.SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;

  if (node.type === 'export_statement') {
    const decl = node.childForFieldName('declaration') ?? node.namedChildren[0];
    if (decl) return extractSymbolName(decl);
  }

  if (node.type === 'decorated_definition') {
    const def = node.namedChildren.find(
      c => c.type === 'function_definition' || c.type === 'class_definition',
    );
    if (def) return extractSymbolName(def);
  }

  return undefined;
}

function refineSymbolType(node: Parser.SyntaxNode, initial: string): string {
  if (node.type === 'export_statement') {
    const decl = node.childForFieldName('declaration') ?? node.namedChildren[0];
    if (decl) return inferSymbolType(decl.type);
  }
  if (node.type === 'decorated_definition') {
    const def = node.namedChildren.find(
      c => c.type === 'function_definition' || c.type === 'class_definition',
    );
    if (def) return inferSymbolType(def.type);
  }
  return initial;
}

// ── AST-based chunking ──────────────────────────────────────────────

function chunkCodeAST(tree: Parser.Tree, content: string, ext: string): Chunk[] {
  const lines = content.split('\n');
  const declTypes = DECLARATION_TYPES[ext] ?? new Set<string>();
  const root = tree.rootNode;

  interface DeclInfo {
    node: Parser.SyntaxNode;
    startRow: number;
    endRow: number;
  }
  const decls: DeclInfo[] = [];

  for (const child of root.namedChildren) {
    if (declTypes.has(child.type)) {
      decls.push({ node: child, startRow: child.startPosition.row, endRow: child.endPosition.row });
    }
  }

  if (decls.length === 0) {
    return [{ content, metadata: { chunk_index: 0 } }];
  }

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  const firstDeclStart = decls[0].startRow;
  if (firstDeclStart > 0) {
    const preamble = lines.slice(0, firstDeclStart).join('\n').trimEnd();
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
  }

  for (let i = 0; i < decls.length; i++) {
    const decl = decls[i];
    const prevEnd = i > 0 ? decls[i - 1].endRow + 1 : firstDeclStart;

    let startLine = decl.startRow;
    for (let row = decl.startRow - 1; row >= prevEnd; row--) {
      const line = lines[row].trim();
      if (
        line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') ||
        line.startsWith('#') || line.startsWith('"""') || line.startsWith("'''") ||
        line === ''
      ) {
        startLine = row;
      } else {
        break;
      }
    }

    while (startLine < decl.startRow && lines[startLine].trim() === '') {
      startLine++;
    }

    const chunkContent = lines.slice(startLine, decl.endRow + 1).join('\n');
    const symbolName = extractSymbolName(decl.node);
    const rawType = inferSymbolType(decl.node.type);
    const symbolType = refineSymbolType(decl.node, rawType);

    chunks.push({
      content: chunkContent,
      metadata: {
        symbol_name: symbolName,
        symbol_type: symbolType,
        start_line: startLine + 1,
        end_line: decl.endRow + 1,
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
    matches.push({ title: match[0].replace(/^## /, ''), index: match.index });
  }

  if (matches.length === 0) {
    return [{ content, metadata: { chunk_index: 0 } }];
  }

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  if (matches[0].index > 0) {
    const preamble = content.slice(0, matches[0].index).trimEnd();
    if (preamble.length > 0) {
      chunks.push({ content: preamble, metadata: { chunk_index: chunkIndex++ } });
    }
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
  const lines = content.split('\n');
  const WINDOW = 400;
  const OVERLAP = 50;
  const chunks: Chunk[] = [];

  if (lines.length <= WINDOW) {
    return [{ content, metadata: { chunk_index: 0, start_line: 1, end_line: lines.length } }];
  }

  let start = 0;
  let chunkIndex = 0;
  while (start < lines.length) {
    const end = Math.min(start + WINDOW, lines.length);
    chunks.push({
      content: lines.slice(start, end).join('\n'),
      metadata: {
        chunk_index: chunkIndex++,
        start_line: start + 1,
        end_line: end,
      },
    });
    if (end >= lines.length) break;
    start += WINDOW - OVERLAP;
  }

  return chunks;
}

// ── Public API ──────────────────────────────────────────────────────

export async function chunkFile(
  content: string,
  filePath: string,
  contentType: string,
): Promise<Chunk[]> {
  if (contentType !== 'code') {
    return chunkMarkdown(content);
  }

  const ext = extname(filePath).toLowerCase();
  if (!EXT_TO_GRAMMAR[ext]) {
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
    return chunks.length > 0 ? chunks : [{ content, metadata: { chunk_index: 0 } }];
  } catch (err) {
    console.error(`[chunker] AST parse failed for ${filePath}, falling back to sliding window:`, err);
    return chunkSlidingWindow(content);
  }
}
