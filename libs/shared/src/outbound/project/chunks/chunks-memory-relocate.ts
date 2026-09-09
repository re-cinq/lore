import { enforceTrue } from "../../../lib/enforce.js";
import { enforceSchema, type ChunkRow } from "./chunk-row-memory.js";

/** The legacy-relocation surface of InMemoryChunks — migrating org_shared rows onto a team schema. Reads/writes the SAME `rows` array `InMemoryChunks` owns (via `host`), always in place, so the host and this store never drift apart. */
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

export class LegacyRelocationStore {
  constructor(private readonly host: { readonly rows: ChunkRow[] }) {}

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
