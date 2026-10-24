import type { Pool } from "pg";

export interface DerivedEdge {
  sourceName: string;
  sourceType: string;
  sourceRepo: string | null;
  targetName: string;
  targetType: string;
  targetRepo: string | null;
  relation: string;
  pinned?: boolean;
}

interface ParsedFile {
  path: string;
  content: string;
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Parse a package.json to derive depends-on edges for each dependency. */
export function parsePackageJsonEdges(
  content: string,
  repo: string,
): DerivedEdge[] {
  try {
    const pkg = JSON.parse(content) as PackageManifest;
    const deps = allPackageDeps(pkg);

    return Object.entries(deps)
      .filter(([, specifier]) => typeof specifier === "string")
      .map(([name, specifier]) => toDependsOnEdge(repo, name, specifier));
  } catch {
    return [];
  }
}

function allPackageDeps(pkg: PackageManifest): Record<string, string> {
  return { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
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
    pinned: specifier.startsWith("github:")
      ? specifier.includes("#")
      : undefined,
  };
}

function parseImportSymbols(
  importList: string,
  fileEntity: string,
  repo: string,
): DerivedEdge[] {
  return importList
    .split(",")
    .map((raw) =>
      raw
        .trim()
        .split(/\s+as\s+/)[0]
        .trim(),
    )
    .filter(Boolean)
    .map((symbol) => importSymbolEdge(fileEntity, repo, symbol));
}

function importSymbolEdge(
  fileEntity: string,
  repo: string,
  symbol: string,
): DerivedEdge {
  return {
    sourceName: fileEntity,
    sourceType: "file",
    sourceRepo: repo,
    targetName: symbol,
    targetType: "symbol",
    targetRepo: null,
    relation: "uses",
  };
}

function parseImportEdges(
  fileEntity: string,
  content: string,
  repo: string,
): DerivedEdge[] {
  const edges: DerivedEdge[] = [];
  const importRe = /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm;

  for (const m of content.matchAll(importRe)) {
    edges.push(...parseImportSymbols(m[1], fileEntity, repo));
  }

  return edges;
}

function parseExtendsEdges(content: string): DerivedEdge[] {
  const edges: DerivedEdge[] = [];
  const extendsRe = /class\s+(\w+)\s+extends\s+(\w+)/gm;

  for (const m of content.matchAll(extendsRe)) {
    edges.push({
      sourceName: m[1],
      sourceType: "symbol",
      sourceRepo: null,
      targetName: m[2],
      targetType: "symbol",
      targetRepo: null,
      relation: "extends",
    });
  }

  return edges;
}

/** Parse a TypeScript/JavaScript file to derive exports, uses, and extends edges. */
function parseTsEdges(
  filePath: string,
  content: string,
  repo: string,
  packageName: string | null,
): DerivedEdge[] {
  const fileEntity = `${repo}/${filePath}`;
  const exportSource = packageName ?? repo;

  return [
    ...parseExportEdges(content, exportSource),
    ...parseImportEdges(fileEntity, content, repo),
    ...parseExtendsEdges(content),
  ];
}

function parseExportEdges(
  content: string,
  exportSource: string,
): DerivedEdge[] {
  const edges: DerivedEdge[] = [];
  const exportRe =
    /^export\s+(?:abstract\s+)?(?:class|const|function\*?|interface|type|enum|let|var)\s+(\w+)/gm;

  for (const m of content.matchAll(exportRe)) {
    edges.push({
      sourceName: exportSource,
      sourceType: "package",
      sourceRepo: null,
      targetName: m[1],
      targetType: "symbol",
      targetRepo: null,
      relation: "exports",
    });
  }

  return edges;
}

/** Resolve the package name declared in any package.json in the file list. */
function resolvePackageName(files: ParsedFile[]): string | null {
  const pkgFile = files.find(
    (f) => f.path === "package.json" || f.path.endsWith("/package.json"),
  );

  if (!pkgFile) {
    return null;
  }

  try {
    const pkg = JSON.parse(pkgFile.content) as { name?: string };

    return pkg.name ?? null;
  } catch {
    return null;
  }
}

function collectFileEdges(
  files: ParsedFile[],
  packageName: string | null,
  repo: string,
): DerivedEdge[] {
  const edges: DerivedEdge[] = [];

  for (const file of files) {
    if (file.path === "package.json" || file.path.endsWith("/package.json")) {
      edges.push(...parsePackageJsonEdges(file.content, repo));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.path)) {
      edges.push(...parseTsEdges(file.path, file.content, repo, packageName));
    }
  }

  return edges;
}

function noneEdge(sym: string): DerivedEdge {
  return {
    sourceName: "none",
    sourceType: "none",
    sourceRepo: null,
    targetName: sym,
    targetType: "symbol",
    targetRepo: null,
    relation: "uses",
  };
}

function noneSentinels(edges: DerivedEdge[]): DerivedEdge[] {
  const exported = new Set(
    edges.filter((e) => e.relation === "exports").map((e) => e.targetName),
  );
  const used = new Set(
    edges.filter((e) => e.relation === "uses").map((e) => e.targetName),
  );

  return [...exported].filter((sym) => !used.has(sym)).map(noneEdge);
}

/** Derive and write graph edges from a batch of ingested files. Called once per ingestFiles run. */
export async function deriveCodeGraphEdges(
  pool: Pool,
  files: ParsedFile[],
  repo: string,
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const packageName = resolvePackageName(files);
  const allEdges = collectFileEdges(files, packageName, repo);

  allEdges.push(...noneSentinels(allEdges));
  await writeEdges(pool, allEdges);
}

function entityKey(name: string, type: string, repo: string | null): string {
  return `${name}\0${type}\0${repo ?? ""}`;
}

type EntityEntry = { name: string; type: string; repo: string | null };

function collectEntities(edges: DerivedEdge[]): Map<string, EntityEntry> {
  const entityMap = new Map<string, EntityEntry>();

  for (const e of edges) {
    const sk = entityKey(e.sourceName, e.sourceType, e.sourceRepo);
    const tk = entityKey(e.targetName, e.targetType, e.targetRepo);
    entityMap.set(sk, {
      name: e.sourceName,
      type: e.sourceType,
      repo: e.sourceRepo,
    });
    entityMap.set(tk, {
      name: e.targetName,
      type: e.targetType,
      repo: e.targetRepo,
    });
  }

  return entityMap;
}

async function resolveEntityIds(
  pool: Pool,
  entityMap: Map<string, EntityEntry>,
): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  for (const [key, ent] of entityMap) {
    idMap.set(key, await upsertEntity(pool, ent.name, ent.type, ent.repo));
  }

  return idMap;
}

async function persistEdges(
  pool: Pool,
  edges: DerivedEdge[],
  idMap: Map<string, string>,
): Promise<void> {
  for (const e of edges) {
    const sk = entityKey(e.sourceName, e.sourceType, e.sourceRepo);
    const tk = entityKey(e.targetName, e.targetType, e.targetRepo);
    const sourceId = idMap.get(sk);
    const targetId = idMap.get(tk);

    if (sourceId && targetId) {
      await upsertEdge(pool, sourceId, targetId, e.relation);
    }
  }
}

async function writeEdges(pool: Pool, edges: DerivedEdge[]): Promise<void> {
  if (edges.length === 0) {
    return;
  }

  const entityMap = collectEntities(edges);
  const idMap = await resolveEntityIds(pool, entityMap);

  await persistEdges(pool, edges, idMap);
}

async function upsertEntity(
  pool: Pool,
  name: string,
  type: string,
  repo: string | null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO memory.entities (name, entity_type, repo)
     VALUES ($1, $2, $3)
     ON CONFLICT (name, entity_type, COALESCE(repo, ''))
     DO UPDATE SET updated_at = now()
     RETURNING id`,
    [name, type, repo],
  );

  return rows[0].id;
}

async function upsertEdge(
  pool: Pool,
  sourceId: string,
  targetId: string,
  relation: string,
): Promise<void> {
  const { rows: existing } = await pool.query<{ id: string }>(
    `SELECT id FROM memory.edges
     WHERE source_id = $1 AND target_id = $2 AND relation_type = $3 AND valid_to IS NULL`,
    [sourceId, targetId, relation],
  );

  if (existing.length > 0) {
    return;
  }

  await pool.query(
    `INSERT INTO memory.edges (source_id, target_id, relation_type)
     VALUES ($1, $2, $3)`,
    [sourceId, targetId, relation],
  );
}
