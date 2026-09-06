/** AST-based chunking for chunker.ts: splits a parsed code file into one chunk per top-level declaration, each carrying its leading comment block. */

import type Parser from "web-tree-sitter";
import {
  type Chunk,
  DECLARATION_TYPES,
  wholeFileChunk,
  lineCount,
} from "./chunk-primitives.js";
import { symbolInfo } from "./chunker-symbols.js";

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

export function chunkCodeAST(
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
