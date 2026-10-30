/** Reference extractor: second tree-sitter pass over a code file that finds imported symbols which are actually called, yielding cross-file call-site data for the CodeChunk.references edge. */

import Parser from "web-tree-sitter";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);

/** A named import that is also called within the same file. */
export interface ImportedCallSite {
  name: string;
  fromPath: string;
}

// ── Shared parser (singleton, re-uses the chunker pattern) ──────────

let parserReady: Promise<void> | null = null;
let sharedParser: Parser | null = null;
const grammarCache = new Map<string, Parser.Language>();

const EXT_TO_WASM: Record<string, string> = {
  ".ts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-tsx.wasm",
  ".js": "tree-sitter-javascript.wasm",
  ".jsx": "tree-sitter-javascript.wasm",
  ".mjs": "tree-sitter-javascript.wasm",
  ".cjs": "tree-sitter-javascript.wasm",
  ".mts": "tree-sitter-typescript.wasm",
  ".cts": "tree-sitter-typescript.wasm",
};

/** The named imports `source` actually calls, paired with the path each came from; an unsupported extension yields none. */
export async function extractImportedCallSites(
  ext: string,
  source: string,
): Promise<ImportedCallSite[]> {
  // Parser.init() must run before a grammar wasm can load, or the load throws and reads as "unsupported extension".
  const parser = await ensureParser();
  const lang = await loadGrammar(ext);

  if (!lang) {
    return [];
  }

  parser.setLanguage(lang);
  const tree = parser.parse(source);
  const root = tree.rootNode;
  const called = collectCalledIdentifiers(root);

  const sites = importStatements(root).flatMap((stmt) =>
    calledImportsOf(stmt, called),
  );

  // The tree lives in the wasm heap, outside the garbage collector: a repo-wide pass that never frees it grows lore-api's memory one file at a time.
  tree.delete();

  return sites;
}

/** One top-level definition of a source file: its name, 1-based line range, text, and the bare identifiers it calls, in first-call order. */
export interface CodeSymbol {
  name: string;
  startLine: number;
  endLine: number;
  text: string;
  calls: string[];
}

/** One named import binding: the name the file uses, the name the module exports, and the module path. */
export interface ImportBinding {
  local: string;
  imported: string;
  fromPath: string;
}

/** The top-level functions, function-valued constants and classes of `source`, with what each calls, plus the file's named imports; an unsupported extension yields neither. */
export async function extractCodeSymbols(
  ext: string,
  source: string,
): Promise<{ symbols: CodeSymbol[]; imports: ImportBinding[] }> {
  const parser = await ensureParser();
  const lang = await loadGrammar(ext);

  if (!lang) {
    return { symbols: [], imports: [] };
  }

  parser.setLanguage(lang);
  const tree = parser.parse(source);
  const root = tree.rootNode;
  const definitions = root.namedChildren.flatMap(definitionsOf);
  const parsed = {
    symbols: definitions.map(toCodeSymbol),
    imports: importStatements(root).flatMap(importBindingsOf),
  };

  tree.delete();

  return parsed;
}

function importStatements(root: Parser.SyntaxNode): Parser.SyntaxNode[] {
  return root.namedChildren.filter(
    (child) => child.type === "import_statement",
  );
}

export async function sourceCallAt(
  ext: string,
  source: string,
  location: { line: number; column: number },
): Promise<{ start: number; end: number; text: string } | null> {
  const parser = await ensureParser();
  const grammar = await loadGrammar(ext);

  if (!grammar) {
    return null;
  }
  parser.setLanguage(grammar);
  const tree = parser.parse(source);

  try {
    return locatedCall(tree.rootNode, location);
  } finally {
    tree.delete();
  }
}

function locatedCall(
  root: Parser.SyntaxNode,
  location: { line: number; column: number },
) {
  if (root.hasError) {
    return null;
  }
  const calls: Parser.SyntaxNode[] = [];

  walk(root, (node) => {
    if (isLocatedCallback(node, location)) {
      calls.push(node);
    }
  });
  const call = calls[0];

  return calls.length === 1 ? callRange(call) : null;
}

function callRange(call: Parser.SyntaxNode) {
  return {
    start: call.startPosition.row + 1,
    end: call.endPosition.row + 1,
    text: call.text,
  };
}

function isLocatedCallback(
  node: Parser.SyntaxNode,
  location: { line: number; column: number },
): boolean {
  const reportedAtCall = registrationAnchors(node).some(
    (anchor) =>
      anchor.row + 1 === location.line && anchor.column + 1 === location.column,
  );

  return node.type === "call_expression" && reportedAtCall && hasCallback(node);
}

/**
 * Where vitest may say a registration begins: the call itself, the member of a
 * modifier (`it.only`, `it.fails`), or the end of a curried callee
 * (`it.each([1, 2])` before its second argument list).
 */
function registrationAnchors(call: Parser.SyntaxNode): Parser.Point[] {
  const callee = call.childForFieldName("function");

  if (callee?.type === "member_expression") {
    return [call.startPosition, ...memberStart(callee)];
  }
  if (callee?.type === "call_expression") {
    return [
      call.startPosition,
      callee.endPosition,
      ...registrationAnchors(callee),
    ];
  }

  return [call.startPosition];
}

function memberStart(member: Parser.SyntaxNode): Parser.Point[] {
  const property = member.childForFieldName("property");

  return property ? [property.startPosition] : [];
}

function hasCallback(node: Parser.SyntaxNode): boolean {
  const args = node.childForFieldName("arguments");

  return (
    args?.namedChildren.some((child) =>
      ["arrow_function", "function_expression"].includes(child.type),
    ) ?? false
  );
}

interface Definition {
  name: string;
  node: Parser.SyntaxNode;
}

const FUNCTION_VALUES = new Set([
  "arrow_function",
  "function_expression",
  "function",
]);

type DefinitionReader = (node: Parser.SyntaxNode) => Definition[];

/** A named declaration (`function f`, `class C`) defines its own name. */
const namedDeclaration: DefinitionReader = (node) => {
  const name = node.childForFieldName("name")?.text;

  return name ? [{ name, node }] : [];
};

/** `const f = () => ...` defines `f`; a constant holding anything but a function defines nothing. */
const functionConstants: DefinitionReader = (node) => {
  const declarators = node.namedChildren.filter((declarator) =>
    FUNCTION_VALUES.has(declarator.childForFieldName("value")?.type ?? ""),
  );

  return declarators.flatMap((declarator) => {
    const name = declarator.childForFieldName("name")?.text;

    return name ? [{ name, node }] : [];
  });
};

/** `export` is unwrapped to the declaration it carries, keeping the export's span. */
const exported: DefinitionReader = (node) => {
  const declaration = node.childForFieldName("declaration");
  const inner = declaration ? definitionsOf(declaration) : [];

  return inner.map((definition) => ({ ...definition, node }));
};

const DEFINITION_READERS: Partial<Record<string, DefinitionReader>> = {
  export_statement: exported,
  function_declaration: namedDeclaration,
  class_declaration: namedDeclaration,
  lexical_declaration: functionConstants,
  variable_declaration: functionConstants,
};

/** The named definitions one top-level statement introduces. */
function definitionsOf(node: Parser.SyntaxNode): Definition[] {
  return DEFINITION_READERS[node.type]?.(node) ?? [];
}

function toCodeSymbol({ name, node }: Definition): CodeSymbol {
  return {
    name,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    text: node.text,
    calls: [...collectCalledIdentifiers(node)],
  };
}

function importBindingsOf(stmt: Parser.SyntaxNode): ImportBinding[] {
  const fromPath = importSource(stmt);

  return importSpecifiers(stmt).map((spec) => {
    const imported = spec.childForFieldName("name")?.text ?? "";

    return { local: localName(spec), imported, fromPath };
  });
}

async function ensureParser(): Promise<Parser> {
  if (!parserReady) {
    parserReady = (async () => {
      await Parser.init();
      sharedParser = new Parser();
    })();
  }
  await parserReady;

  return sharedParser!;
}

/** The grammar for one extension, or null when the extension is unsupported or its wasm cannot be read. */
async function loadGrammar(ext: string): Promise<Parser.Language | null> {
  const cached = grammarCache.get(ext);

  if (cached) {
    return cached;
  }
  const wasmFile = EXT_TO_WASM[ext];

  if (!wasmFile) {
    return null;
  }
  const lang = await readGrammar(wasmFile);

  if (lang) {
    grammarCache.set(ext, lang);
  }

  return lang;
}

/** Reads one grammar out of the tree-sitter-wasms package. */
async function readGrammar(wasmFile: string): Promise<Parser.Language | null> {
  try {
    const wasmsDir = join(
      require.resolve("tree-sitter-wasms/package.json"),
      "..",
      "out",
    );

    return await Parser.Language.load(await readFile(join(wasmsDir, wasmFile)));
  } catch {
    return null;
  }
}

// ── AST traversal helpers ─────────────────────────────────────────────

/** Collect every identifier text that appears as the direct callee of a call expression anywhere in the tree. */
function collectCalledIdentifiers(root: Parser.SyntaxNode): Set<string> {
  const called = new Set<string>();

  walk(root, (node) => {
    const callee = directCallee(node);

    if (callee) {
      called.add(callee);
    }
  });

  return called;
}

/** The bare identifier this node calls, or null when it is not a call of one. `a.b()` calls a member expression, not an identifier, so it does not count. */
function directCallee(node: Parser.SyntaxNode): string | null {
  if (node.type !== "call_expression") {
    return null;
  }
  const fn = node.childForFieldName("function");

  return fn?.type === "identifier" ? fn.text : null;
}

function walk(node: Parser.SyntaxNode, visit: (n: Parser.SyntaxNode) => void) {
  visit(node);

  for (const child of node.namedChildren) {
    walk(child, visit);
  }
}

/** The named imports of one import statement that the file actually calls. */
function calledImportsOf(
  stmt: Parser.SyntaxNode,
  called: Set<string>,
): ImportedCallSite[] {
  const fromPath = importSource(stmt);

  if (!fromPath) {
    return [];
  }

  return namedImportSpecifiers(stmt)
    .filter((name) => called.has(name))
    .map((name) => ({ name, fromPath }));
}

/** The module path string from an `import_statement` node (strips surrounding quotes). */
function importSource(stmt: Parser.SyntaxNode): string {
  const strNode = stmt.namedChildren.find((c) => c.type === "string");

  if (!strNode) {
    return "";
  }
  // string_fragment holds the path without its quotes; the node text keeps them.
  const frag = strNode.namedChildren.find((c) => c.type === "string_fragment");

  return frag ? frag.text : strNode.text.slice(1, -1);
}

/** All named-import specifier local names in a single import statement node. */
function namedImportSpecifiers(stmt: Parser.SyntaxNode): string[] {
  return importSpecifiers(stmt).map(localName).filter(Boolean);
}

/** The `import_specifier` nodes of one import statement's `{ ... }` clause. */
function importSpecifiers(stmt: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const clause = stmt.namedChildren.find((c) => c.type === "import_clause");
  const named = clause?.namedChildren.find((c) => c.type === "named_imports");

  return (named?.namedChildren ?? []).filter(
    (c) => c.type === "import_specifier",
  );
}

/** `import { a as b }` binds `b`, so the alias wins over the imported name. */
function localName(spec: Parser.SyntaxNode): string {
  const alias = spec.childForFieldName("alias");
  const name = spec.childForFieldName("name");

  return (alias ?? name)?.text ?? "";
}
