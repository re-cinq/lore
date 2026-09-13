import type {
  CatalogEntry,
  CatalogEvent,
  CatalogEventsRepository,
} from "./catalog-events-port.js";

/** Behavioral spec of {@link CatalogEventsRepository}, backed by arrays; `append`/`setEntries` stand in for PgAgentDefs' CTE appends and the agent_definitions rows the snapshot reads. */
export class InMemoryCatalogEvents implements CatalogEventsRepository {
  private readonly events: CatalogEvent[] = [];
  private entries: CatalogEntry[] = [];
  private nextId = 1n;

  append(name: string, projectId: string | null, op: CatalogEvent["op"]): void {
    this.events.push({ id: String(this.nextId++), name, projectId, op });
  }

  setEntries(entries: CatalogEntry[]): void {
    this.entries = [...entries];
  }

  async listSince(cursor: string, limit: number): Promise<CatalogEvent[]> {
    const raw = this.events
      .filter((event) => BigInt(event.id) > BigInt(cursor))
      .slice(0, limit);

    const expanded: CatalogEvent[] = [];

    for (const event of raw) {
      expanded.push(event);
      // An org-level upsert fans out to every project row that inherits it so
      // cluster-agents re-render the qualified CR pair with the updated content.
      if (event.projectId === null && event.op === "upsert") {
        for (const entry of this.entries) {
          if (entry.name === event.name && entry.projectId !== null) {
            expanded.push({ ...event, projectId: entry.projectId });
          }
        }
      }
    }

    return expanded;
  }

  async snapshot(): Promise<{ entries: CatalogEntry[]; cursor: string }> {
    const last = this.events.at(-1);

    return { entries: [...this.entries], cursor: last?.id ?? "0" };
  }
}
