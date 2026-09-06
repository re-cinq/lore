/** Chunk shape + the declaration-node-type table and small helpers shared by chunker.ts (the tree-sitter driver) and chunker-ast.ts (the per-declaration splitter), so neither imports the other. */

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

export const DECLARATION_TYPES: Record<string, Set<string>> = {
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
export function wholeFileChunk(
  content: string,
  extra?: Partial<Chunk["metadata"]>,
): Chunk[] {
  return [{ content, metadata: { chunk_index: 0, ...extra } }];
}

/** Line count of the file's real content — a trailing newline terminates the last line rather than opening a phantom empty one. */
export function lineCount(content: string): number {
  return content.replace(/\n$/, "").split("\n").length;
}
