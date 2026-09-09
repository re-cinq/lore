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

async function loadGrammar(ext: string): Promise<Parser.Language | null> {
  const cached = grammarCache.get(ext);
  if (cached) return cached;

  const EXT_TO_WASM: Record<string, string> = {
    ".ts": "tree-sitter-typescript.wasm",
    ".tsx": "tree-sitter-tsx.wasm",
    ".js": "tree-sitter-javascript.wasm",
    ".jsx": "tree-sitter-javascript.wasm",
  };

  const wasmFile = EXT_TO_WASM[ext];
  if (!wasmFile) return null;

  try {
    const wasmsDir = join(
      require.resolve("tree-sitter-wasms/package.json"),
      "..",
      "out",
    );
    const buf = await readFile(join(wasmsDir, wasmFile));
    const lang = await Parser.Language.load(buf);
    grammarCache.set(ext, lang);
    return lang;
  } catch {
    return null;
  }
}

// ── AST traversal helpers ─────────────────────────────────────────────

/** All named-import specifier local names in a single import statement node. */
function namedImportSpecifiers(stmt: Parser.SyntaxNode): string[] {
  const clause = stmt.namedChildren.find((c) => c.type === "import_clause");
  if (!clause) return [];
  const named =
    clause.namedChildren.find((c) => c.type === "named_imports") ?? null;
  if (!named) return [];
  return named.namedChildren
    .filter((c) => c.type === "import_specifier")
    .map((spec) => {
      // `import { a as b }` — the local name is the alias, else the name
      const alias = spec.childForFieldName("alias");
      const name = spec.childForFieldName("name");
      return (alias ?? name)?.text ?? "";
    })
    .filter(Boolean);
}

/** The module path string from an `import_statement` node (strips surrounding quotes). */
function importSource(stmt: Parser.SyntaxNode): string {
  const strNode = stmt.namedChildren.find((c) => c.type === "string");
  if (!strNode) return "";
  // The string_fragment child holds the raw path without surrounding quotes
  const frag = strNode.namedChildren.find((c) => c.type === "string_fragment");
  return frag ? frag.text : strNode.text.slice(1, -1);
}

/** Collect every identifier text that appears as the direct callee of a call expression anywhere in the tree. */
function collectCalledIdentifiers(root: Parser.SyntaxNode): Set<string> {
  const called = new Set<string>();
  walk(root, (node) => {
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn?.type === "identifier") {
        called.add(fn.text);
      }
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

// ── Public API ────────────────────────────────────────────────────────

/**
 * Returns the named imports that are actually called within `source`, together
 * with the path they were imported from. Unsupported extensions return `[]`.
 */
export async function extractImportedCallSites(
  ext: string,
  source: string,
): Promise<ImportedCallSite[]> {
  const parser = await ensureParser();
  const lang = await loadGrammar(ext);
  if (!lang) return [];

  parser.setLanguage(lang);
  const tree = parser.parse(source);
  const root = tree.rootNode;

  // Collect all identifiers that are directly called
  const called = collectCalledIdentifiers(root);

  const result: ImportedCallSite[] = [];

  for (const child of root.namedChildren) {
    if (child.type !== "import_statement") continue;

    const fromPath = importSource(child);
    if (!fromPath) continue;

    for (const name of namedImportSpecifiers(child)) {
      if (called.has(name)) {
        result.push({ name, fromPath });
      }
    }
  }

  return result;
}
