import type { Pool } from "pg";
import { settleNoImporterSentinels, writeEdges } from "./code-graph-writes.js";

export interface DerivedEdge {
  sourceName: string;
  sourceType: string;
  sourceRepo: string | null;
  targetName: string;
  targetType: string;
  targetRepo: string | null;
  relation: string;
  properties: Record<string, unknown>;
}

interface ParsedFile {
  path: string;
  content: string;
}

interface PackageManifest {
  name?: string;
  main?: string;
  module?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const DEFAULT_ENTRY_MODULES = ["index.ts", "src/index.ts", "index.js"];
const EXPORT_RE =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(class|const|function\*?|interface|type|enum|let|var)\s+(\w+)/gm;
const IMPORT_RE =
  /^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm;
const EXTENDS_RE = /class\s+(\w+)\s+extends\s+(\w+)[^{]*\{/g;
const MEMBER_RE =
  /^(?:(?:public|private|protected|static|readonly|async|override|get|set)\s+)*#?(\w+)\s*[(:=;<?!]/;

/** Parse a package.json to derive depends-on edges for each dependency. */
export function parsePackageJsonEdges(
  content: string,
  repo: string,
): DerivedEdge[] {
  const pkg = parseManifest(content);
  const deps = { ...pkg.dependencies, ...pkg.peerDependencies };

  return Object.entries(deps)
    .filter(([, specifier]) => typeof specifier === "string")
    .map(([name, specifier]) => toDependsOnEdge(repo, name, specifier));
}

/** Derive and write graph edges from a batch of ingested files. Called once per ingestFiles run. */
export async function deriveCodeGraphEdges(
  pool: Pool,
  files: ParsedFile[],
  repo: string,
): Promise<void> {
  const edges = collectFileEdges(files, repo);

  if (edges.length === 0) {
    return;
  }

  await writeEdges(pool, edges);
  await settleNoImporterSentinels(pool, edges);
}

function parseManifest(content: string): PackageManifest {
  try {
    return JSON.parse(content) as PackageManifest;
  } catch {
    return {};
  }
}

function toDependsOnEdge(
  repo: string,
  name: string,
  specifier: string,
): DerivedEdge {
  return {
    sourceName: repo,
    sourceType: "repo",
    sourceRepo: repo,
    targetName: name,
    targetType: "package",
    targetRepo: null,
    relation: "depends-on",
    properties: { specifier, pinned: isPinned(specifier) },
  };
}

/** A `github:` specifier is pinned only by a `#ref`; any other specifier resolves through a registry version. */
function isPinned(specifier: string): boolean {
  return !specifier.startsWith("github:") || specifier.includes("#");
}

function collectFileEdges(files: ParsedFile[], repo: string): DerivedEdge[] {
  const manifestFile = files.find((f) => isManifest(f.path));
  const manifest = parseManifest(manifestFile?.content ?? "{}");
  const entryModule = resolveEntryModule(manifest, files);
  const exportSource = manifest.name ?? repo;

  return files.flatMap((file) => [
    ...(isManifest(file.path) ? parsePackageJsonEdges(file.content, repo) : []),
    ...(file.path === entryModule ? parseExportEdges(file, exportSource) : []),
    ...(isScript(file.path) ? parseScriptEdges(file, repo) : []),
  ]);
}

function isManifest(path: string): boolean {
  return path === "package.json" || path.endsWith("/package.json");
}

/** The module a consumer gets from a bare import: the manifest's `module`/`main`, else the conventional index. */
function resolveEntryModule(
  manifest: PackageManifest,
  files: ParsedFile[],
): string | undefined {
  const declared = manifest.module ?? manifest.main;

  if (declared) {
    return declared.replace(/^\.\//, "");
  }

  const paths = new Set(files.map((f) => f.path));

  return DEFAULT_ENTRY_MODULES.find((p) => paths.has(p));
}

function parseExportEdges(
  file: ParsedFile,
  exportSource: string,
): DerivedEdge[] {
  return [...file.content.matchAll(EXPORT_RE)].map((m) => ({
    sourceName: exportSource,
    sourceType: "package",
    sourceRepo: null,
    targetName: m[2],
    targetType: "symbol",
    targetRepo: null,
    relation: "exports",
    properties: { kind: m[1].replace("*", ""), path: file.path },
  }));
}

function isScript(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path);
}

function parseScriptEdges(file: ParsedFile, repo: string): DerivedEdge[] {
  return [...parseImportEdges(file, repo), ...parseExtendsEdges(file)];
}

function parseImportEdges(file: ParsedFile, repo: string): DerivedEdge[] {
  const fileEntity = `${repo}/${file.path}`;

  return [...file.content.matchAll(IMPORT_RE)].flatMap((m) =>
    importedSymbols(m[1]).map((symbol) => ({
      sourceName: fileEntity,
      sourceType: "file",
      sourceRepo: repo,
      targetName: symbol,
      targetType: "symbol",
      targetRepo: null,
      relation: "uses",
      properties: { repo, path: file.path, from: m[2] },
    })),
  );
}

function importedSymbols(importList: string): string[] {
  return importList.split(",").map(importedName).filter(Boolean);
}

/** `type Foo as Bar` imports `Foo`. */
function importedName(specifier: string): string {
  const unaliased = specifier.split(/\s+as\s+/)[0];

  return unaliased.trim().replace(/^type\s+/, "");
}

function parseExtendsEdges(file: ParsedFile): DerivedEdge[] {
  return [...file.content.matchAll(EXTENDS_RE)].map((m) => ({
    sourceName: m[1],
    sourceType: "symbol",
    sourceRepo: null,
    targetName: m[2],
    targetType: "symbol",
    targetRepo: null,
    relation: "extends",
    properties: {
      added_members: classMembers(
        classBody(file.content, m.index + m[0].length),
      ),
      path: file.path,
    },
  }));
}

/** The class body's own lines, with every nested block cut out, read from just past its opening brace. */
function classBody(content: string, bodyStart: number): string {
  let depth = 1;
  let body = "";

  for (const char of content.slice(bodyStart)) {
    depth += braceDelta(char);

    if (depth === 0) {
      break;
    }

    body += bodyChar(char, depth);
  }

  return body;
}

function braceDelta(char: string): number {
  return Number(char === "{") - Number(char === "}");
}

/** A nested block opening ends the member's line; everything inside the block is dropped. */
function bodyChar(char: string, depth: number): string {
  if (depth === 1 && char !== "}") {
    return char;
  }

  return depth === 2 && char === "{" ? "\n" : "";
}

function classMembers(body: string): string[] {
  const names = body
    .split("\n")
    .map((line) => MEMBER_RE.exec(line.trim())?.[1])
    .filter((name): name is string => !!name && name !== "constructor");

  return [...new Set(names)];
}
