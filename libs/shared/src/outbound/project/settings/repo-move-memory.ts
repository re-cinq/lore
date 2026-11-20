import type { KnowledgeMoveCount, KnowledgeMoveOptions } from "./repo-move.js";
import { REPO_KEYED_TABLES } from "./repo-move-registry.js";

interface HeldRow {
  table: string;
  repo: string;
  key: string;
}

/** The in-memory double of the stored knowledge a mirror's move works on: rows keyed by table, repository and key, moved under the same rule as the SQL. */
export class InMemoryKnowledge {
  private rows: HeldRow[] = [];

  seed(table: string, repo: string, key = ""): void {
    this.rows.push({ table, repo, key });
  }

  rowsOf(table: string, repo: string): string[] {
    return this.rows
      .filter((row) => row.table === table && row.repo === repo)
      .map((row) => row.key);
  }

  move(
    from: string,
    to: string,
    { dryRun }: KnowledgeMoveOptions,
  ): KnowledgeMoveCount[] {
    const counts = movedTables().map((table) =>
      this.moveTable(table, from, to),
    );

    if (!dryRun) {
      this.rows = this.rows.map((row) => relocated(row, to, counts));
    }

    return counts.map(({ table, moved, kept_conflict }) => ({
      table,
      moved,
      kept_conflict,
    }));
  }

  private moveTable(table: string, from: string, to: string) {
    const held = this.rows.filter(
      (row) => row.table === table && row.repo === from,
    );
    const taken = new Set(this.rowsOf(table, to));
    const moving = held.filter((row) => !taken.has(row.key));

    return {
      table,
      moved: moving.length,
      kept_conflict: held.length - moving.length,
      moving,
    };
  }
}

function movedTables(): string[] {
  return REPO_KEYED_TABLES.flatMap((entry) =>
    entry.policy === "move" ? [`${entry.schema}.${entry.table}`] : [],
  );
}

function relocated(
  row: HeldRow,
  to: string,
  counts: Array<{ moving: HeldRow[] }>,
): HeldRow {
  return counts.some(({ moving }) => moving.includes(row))
    ? { ...row, repo: to }
    : row;
}
