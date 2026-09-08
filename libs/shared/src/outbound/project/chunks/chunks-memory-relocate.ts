import { enforceTrue } from "../../../lib/enforce.js";
import { enforceSchema, type ChunkRow } from "./chunk-row-memory.js";

/** The reindex-job maintenance surface of InMemoryChunks — which files a repo's reindex-job chunks own, aging them out, pruning them, and migrating legacy org_shared rows onto a team schema. Reads/writes the SAME `rows` array `InMemoryChunks` owns (via `host`), always in place, so the host and this store never drift apart. */
/** Moves one legacy row into the team schema. `ingested_by` is stamped only where it was ABSENT and the type is one the reindex job owns — a chunk written by another ingester keeps its provenance, or the heal sweep would later treat it as its own to re-chunk. */
function adoptRow(row: ChunkRow, schema: string): void {
  const adopt =
    row.metadata.ingested_by == null &&
    ["doc", "code", "adr", "spec"].includes(row.contentType);

  row.schema = schema;
  row.team = schema;
  row.metadata = {
    ...row.metadata,
    migrated_from: "org_shared",
    ...(adopt ? { ingested_by: "reindex-job" } : {}),
  };
}

/** The rows of the named files whose OLDEST chunk predates the cutoff — a file re-ingested recently is left alone even when some of its chunks are older. */
function dueForTouch(named: ChunkRow[], cutoff: number): ChunkRow[] {
  const oldestByFile = new Map<string, number>();

  for (const row of named) {
    const stamp = new Date(row.ingestedAt).getTime();
    const oldest = oldestByFile.get(row.filePath);

    oldestByFile.set(row.filePath, Math.min(stamp, oldest ?? stamp));
  }

  return named.filter(
    (row) => (oldestByFile.get(row.filePath) ?? Infinity) < cutoff,
  );
}

export class ReindexChunkStore {
  constructor(private readonly host: { readonly rows: ChunkRow[] }) {}

  private reindexOwnedForRepo(schema: string, repo: string): ChunkRow[] {
    return this.host.rows.filter(
      (row) =>
        row.schema === schema &&
        row.repo === repo &&
        row.metadata.ingested_by === "reindex-job",
    );
  }

  async staleChunkCount(repo: string, olderThanDays: number): Promise<number> {
    const cutoff = Date.now() - olderThanDays * 86_400_000;

    return this.host.rows.filter(
      (row) =>
        row.repo === repo &&
        row.metadata.ingested_by === "reindex-job" &&
        new Date(row.ingestedAt).getTime() < cutoff,
    ).length;
  }

  async reindexOwnedFilePaths(schema: string, repo: string): Promise<string[]> {
    enforceSchema(schema);

    return Array.from(
      new Set(
        this.reindexOwnedForRepo(schema, repo).map((row) => row.filePath),
      ),
    );
  }

  async chunkedFilePaths(schema: string, repo: string): Promise<string[]> {
    enforceSchema(schema);

    return Array.from(
      new Set(
        this.host.rows
          .filter((row) => row.schema === schema && row.repo === repo)
          .map((row) => row.filePath),
      ),
    );
  }

  async staleChunkerFiles(
    schema: string,
    repo: string,
    version: number,
    limit: number,
  ): Promise<string[]> {
    enforceSchema(schema);
    const stale = this.host.rows.filter(
      (row) =>
        row.schema === schema &&
        row.repo === repo &&
        row.contentType === "code" &&
        ((row.metadata.chunker_version as number | undefined) ?? 0) < version,
    );

    return Array.from(new Set(stale.map((row) => row.filePath)))
      .sort()
      .slice(0, limit);
  }

  async touchChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
    minAgeDays: number,
  ): Promise<number> {
    enforceSchema(schema);
    const paths = new Set(filePaths);
    const cutoff = Date.now() - minAgeDays * 86_400_000;
    const named = this.reindexOwnedForRepo(schema, repo).filter((row) =>
      paths.has(row.filePath),
    );
    const targets = dueForTouch(named, cutoff);
    const now = new Date().toISOString();

    for (const row of targets) {
      row.ingestedAt = now;
    }

    return targets.length;
  }

  async pruneChunksForFiles(
    schema: string,
    repo: string,
    filePaths: string[],
  ): Promise<number> {
    enforceSchema(schema);
    const paths = new Set(filePaths);
    const before = this.host.rows.length;

    const kept = this.host.rows.filter(
      (row) =>
        !(
          row.schema === schema &&
          row.repo === repo &&
          row.metadata.ingested_by === "reindex-job" &&
          paths.has(row.filePath)
        ),
    );

    this.host.rows.splice(0, this.host.rows.length, ...kept);

    return before - this.host.rows.length;
  }

  /** What the target already holds, read BEFORE anything moves. Postgres evaluates every dedupe probe against pre-statement state, so a file split across several chunks must move wholesale — probing live state would let its own first chunk dedupe away the rest. */
  private snapshotTarget(schema: string, repo: string) {
    const target = this.host.rows.filter(
      (row) => row.schema === schema && row.repo === repo,
    );

    return {
      files: new Set(target.map((row) => row.filePath)),
      ids: new Set(target.map((row) => row.id)),
    };
  }

  async relocateLegacyChunks(
    schema: string,
    repo: string,
  ): Promise<{ moved: number; dropped: number }> {
    enforceSchema(schema);
    enforceTrue(
      schema !== "org_shared",
      Error,
      "relocateLegacyChunks target must not be org_shared",
    );
    const { moved, dropIds } = this.adoptLegacyRows(schema, repo);

    this.dropLegacyRows(repo, dropIds);

    return { moved, dropped: moved + dropIds.size };
  }

  /** Removes the org_shared rows the adopt pass marked, in place so the host keeps the same array. */
  private dropLegacyRows(repo: string, dropIds: Set<string>): void {
    const kept = this.host.rows.filter(
      (row) =>
        !(
          row.schema === "org_shared" &&
          row.repo === repo &&
          dropIds.has(row.id)
        ),
    );

    this.host.rows.splice(0, this.host.rows.length, ...kept);
  }

  /** Moves each legacy row the target does not already hold, and collects the ids of those it does. A row skipped because the target has a newer copy is still dropped — the two ids are counted separately so the caller can report what moved against what merely went away. */
  private adoptLegacyRows(schema: string, repo: string) {
    const already = this.snapshotTarget(schema, repo);
    const dropIds = new Set<string>();
    let moved = 0;

    for (const row of this.host.rows.filter(
      (row) => row.schema === "org_shared" && row.repo === repo,
    )) {
      if (already.files.has(row.filePath) || already.ids.has(row.id)) {
        dropIds.add(row.id);
        continue;
      }
      adoptRow(row, schema);
      moved++;
    }

    return { moved, dropIds };
  }
}
