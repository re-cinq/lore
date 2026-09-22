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
    return this.events
      .filter((event) => BigInt(event.id) > BigInt(cursor))
      .slice(0, limit)
      .flatMap((event) => [event, ...this.dependentsOf(event)]);
  }

  /** An org-level event re-serves every project entry of that name, since each one's resolution inherits the org row. */
  private dependentsOf(event: CatalogEvent): CatalogEvent[] {
    if (event.projectId !== null) {
      return [];
    }

    return this.entries
      .filter((entry) => entry.name === event.name && entry.projectId !== null)
      .map((entry) => ({ ...event, projectId: entry.projectId, op: "upsert" }));
  }

  async snapshot(): Promise<{ entries: CatalogEntry[]; cursor: string }> {
    const last = this.events.at(-1);

    return { entries: [...this.entries], cursor: last?.id ?? "0" };
  }
}
