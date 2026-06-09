/**
 * spec-traceability-graph — deterministic source → CodeChunk parser. Walks a
 * file's top-level declarations via the TypeScript AST (zero-LLM) and emits one
 * descriptor per named symbol with its 1-based line range and a content hash.
 * The projector ({@link ./project-code-file}) turns these into CodeChunk nodes
 * that coverage's `Coverage.covers` and the drift checker resolve against.
 */

import { createHash } from "node:crypto";
import * as ts from "typescript";

export interface CodeChunkDescriptor {
  symbol_name: string;
  symbol_type: string;
  start_line: number;
  end_line: number;
  content_hash: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The named-declaration kinds we project; anything else (imports, exports, bare expressions) is skipped. */
function describeSymbol(node: ts.Statement): { name: string; type: string } | null {
  if (ts.isFunctionDeclaration(node) && node.name) return { name: node.name.text, type: "function" };
  if (ts.isClassDeclaration(node) && node.name) return { name: node.name.text, type: "class" };
  if (ts.isInterfaceDeclaration(node)) return { name: node.name.text, type: "interface" };
  if (ts.isTypeAliasDeclaration(node)) return { name: node.name.text, type: "type" };
  if (ts.isEnumDeclaration(node)) return { name: node.name.text, type: "enum" };
  if (ts.isVariableStatement(node)) {
    const declaration = node.declarationList.declarations[0];
    if (declaration && ts.isIdentifier(declaration.name)) return { name: declaration.name.text, type: "variable" };
  }
  return null;
}

export function parseCodeChunks(filePath: string, content: string): CodeChunkDescriptor[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const lineOf = (pos: number): number => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

  const chunks: CodeChunkDescriptor[] = [];
  for (const node of sourceFile.statements) {
    const symbol = describeSymbol(node);
    if (!symbol) continue;
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    chunks.push({
      symbol_name: symbol.name,
      symbol_type: symbol.type,
      start_line: lineOf(start),
      end_line: lineOf(end),
      content_hash: sha256(content.slice(start, end)),
    });
  }
  return chunks;
}
