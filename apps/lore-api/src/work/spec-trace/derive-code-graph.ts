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

/** Parse a package.json to derive depends-on edges for each dependency. */
export function parsePackageJsonEdges(
  content: string,
  repo: string,
): DerivedEdge[] {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const deps: Record<string, string> = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    };

    return Object.entries(deps)
      .filter(([, specifier]) => typeof specifier === "string")
      .map(([name, specifier]) => ({
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
      }));
  } catch {
    return [];
  }
}

/** Parse a TypeScript/JavaScript file to derive exports, uses, and extends edges. */
function parseTsEdges(
  filePath: string,
  content: string,
  repo: string,
  packageName: string | null,
): DerivedEdge[] {
  const edges: DerivedEdge[] = [];
  const fileEntity = `${repo}/${filePath}`;
  const exportSource = packageName ?? repo;

  // Exports: export class/const/function/interface/type/enum/let/var Foo
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

  // Named imports: import { X, Y as Z } from "lib"
  const importRe = /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/gm;
  for (const m of content.matchAll(importRe)) {
    for (const raw of m[1].split(",")) {
      const symbol = raw
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (symbol) {
        edges.push({
          sourceName: fileEntity,
          sourceType: "file",
          sourceRepo: repo,
          targetName: symbol,
          targetType: "symbol",
          targetRepo: null,
          relation: "uses",
        });
      }
    }
  }

  // Class inheritance: class Foo extends Bar
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

/** Resolve the package name declared in any package.json in the file list. */
function resolvePackageName(files: ParsedFile[]): string | null {
  const pkgFile = files.find(
    (f) => f.path === "package.json" || f.path.endsWith("/package.json"),
  );
  if (!pkgFile) return null;
  try {
    const pkg = JSON.parse(pkgFile.content) as { name?: string };
    return pkg.name ?? null;
  } catch {
    return null;
  }
}

/** Derive and write graph edges from a batch of ingested files. Called once per ingestFiles run. */
export async function deriveCodeGraphEdges(
  pool: Pool,
  files: ParsedFile[],
  repo: string,
): Promise<void> {
  if (files.length === 0) return;

  const packageName = resolvePackageName(files);
  const allEdges: DerivedEdge[] = [];

  for (const file of files) {
    if (file.path === "package.json" || file.path.endsWith("/package.json")) {
      allEdges.push(...parsePackageJsonEdges(file.content, repo));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.path)) {
      allEdges.push(
        ...parseTsEdges(file.path, file.content, repo, packageName),
      );
    }
  }

  // Track which exported symbols have at least one real importer in this batch
  const exportedSymbols = new Set<string>();
  const usedSymbols = new Set<string>();
  for (const e of allEdges) {
    if (e.relation === "exports") exportedSymbols.add(e.targetName);
    if (e.relation === "uses") usedSymbols.add(e.targetName);
  }

  // Emit a "none" sentinel for every export that has no importer in this batch,
  // making "no importers" distinguishable from "not derived".
  for (const sym of exportedSymbols) {
    if (!usedSymbols.has(sym)) {
      allEdges.push({
        sourceName: "none",
        sourceType: "none",
        sourceRepo: null,
        targetName: sym,
        targetType: "symbol",
        targetRepo: null,
        relation: "uses",
      });
    }
  }

  await writeEdges(pool, allEdges);
}

async function writeEdges(pool: Pool, edges: DerivedEdge[]): Promise<void> {
  if (edges.length === 0) return;

  // Collect unique entities
  const entityMap = new Map<
    string,
    { name: string; type: string; repo: string | null }
  >();
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

  const idMap = new Map<string, string>();
  for (const [key, ent] of entityMap) {
    idMap.set(key, await upsertEntity(pool, ent.name, ent.type, ent.repo));
  }

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

function entityKey(name: string, type: string, repo: string | null): string {
  return `${name}\0${type}\0${repo ?? ""}`;
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
  if (existing.length > 0) return;

  await pool.query(
    `INSERT INTO memory.edges (source_id, target_id, relation_type)
     VALUES ($1, $2, $3)`,
    [sourceId, targetId, relation],
  );
}
