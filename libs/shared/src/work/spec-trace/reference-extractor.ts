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

const EXT_TO_WASM: Record<string, string> = {
  ".ts": "tree-sitter-typescript.wasm",
  ".tsx": "tree-sitter-tsx.wasm",
  ".js": "tree-sitter-javascript.wasm",
  ".jsx": "tree-sitter-javascript.wasm",
};

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

/** All named-import specifier local names in a single import statement node. */
function namedImportSpecifiers(stmt: Parser.SyntaxNode): string[] {
  const clause = stmt.namedChildren.find((c) => c.type === "import_clause");
  const named = clause?.namedChildren.find((c) => c.type === "named_imports");

  if (!named) {
    return [];
  }
  const specifiers = named.namedChildren.filter(
    (c) => c.type === "import_specifier",
  );

  return specifiers.map(localName).filter(Boolean);
}

/** `import { a as b }` binds `b`, so the alias wins over the imported name. */
function localName(spec: Parser.SyntaxNode): string {
  const alias = spec.childForFieldName("alias");
  const name = spec.childForFieldName("name");

  return (alias ?? name)?.text ?? "";
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

/** The bare identifier this node calls, or null when it is not a call of one. `a.b()` calls a member expression, not an identifier, so it does not count. */
function directCallee(node: Parser.SyntaxNode): string | null {
  if (node.type !== "call_expression") {
    return null;
  }
  const fn = node.childForFieldName("function");

  return fn?.type === "identifier" ? fn.text : null;
}

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

function walk(node: Parser.SyntaxNode, visit: (n: Parser.SyntaxNode) => void) {
  visit(node);

  for (const child of node.namedChildren) {
    walk(child, visit);
  }
}

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
  const root = parser.parse(source).rootNode;
  const called = collectCalledIdentifiers(root);

  const imports = root.namedChildren.filter(
    (child) => child.type === "import_statement",
  );

  return imports.flatMap((stmt) => calledImportsOf(stmt, called));
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
