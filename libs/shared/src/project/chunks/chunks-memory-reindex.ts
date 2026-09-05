import { enforceTrue } from "../../lib/enforce.js";
import { enforceSchema, type ChunkRow } from "./chunk-row-memory.js";

/** The reindex-job maintenance surface of InMemoryChunks — which files a repo's reindex-job chunks own, aging them out, pruning them, and migrating legacy org_shared rows onto a team schema. Reads/writes the SAME `rows` array `InMemoryChunks` owns (via `host`, since several of these reassign the array wholesale rather than mutate in place). */
export class ReindexChunkStore {
  constructor(private readonly host: { rows: ChunkRow[] }) {}

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
    const oldestByFile = new Map<string, number>();

    for (const row of named) {
      const stamp = new Date(row.ingestedAt).getTime();
      const oldest = oldestByFile.get(row.filePath);

      oldestByFile.set(row.filePath, Math.min(stamp, oldest ?? stamp));
    }

    const targets = named.filter(
      (row) => (oldestByFile.get(row.filePath) ?? Infinity) < cutoff,
    );
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

    this.host.rows = this.host.rows.filter(
      (row) =>
        !(
          row.schema === schema &&
          row.repo === repo &&
          row.metadata.ingested_by === "reindex-job" &&
          paths.has(row.filePath)
        ),
    );

    return before - this.host.rows.length;
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
    // Snapshot target before moving anything — Pg's dedupe probes all see pre-statement state, so a multi-chunk file moves wholesale rather than deduping against its own first chunk.
    const target = this.host.rows.filter(
      (row) => row.schema === schema && row.repo === repo,
    );
    const targetFiles = new Set(target.map((row) => row.filePath));
    const targetIds = new Set(target.map((row) => row.id));
    const legacy = this.host.rows.filter(
      (row) => row.schema === "org_shared" && row.repo === repo,
    );
    const dropIds = new Set<string>();
    let moved = 0;

    for (const row of legacy) {
      if (targetFiles.has(row.filePath) || targetIds.has(row.id)) {
        dropIds.add(row.id);
        continue;
      }
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
      moved++;
    }

    this.host.rows = this.host.rows.filter(
      (row) =>
        !(
          row.schema === "org_shared" &&
          row.repo === repo &&
          dropIds.has(row.id)
        ),
    );

    return { moved, dropped: moved + dropIds.size };
  }
}
