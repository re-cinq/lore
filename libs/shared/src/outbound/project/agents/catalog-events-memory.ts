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

  private fanOutProjectEntries(event: CatalogEvent): CatalogEvent[] {
    return this.entries
      .filter((e) => e.name === event.name && e.projectId !== null)
      .map((e) => ({ ...event, projectId: e.projectId }));
  }

  async listSince(cursor: string, limit: number): Promise<CatalogEvent[]> {
    const raw = this.events
      .filter((e) => BigInt(e.id) > BigInt(cursor))
      .slice(0, limit);

    const expanded: CatalogEvent[] = [];

    for (const event of raw) {
      expanded.push(event);
      if (event.projectId === null && event.op === "upsert") {
        expanded.push(...this.fanOutProjectEntries(event));
      }
    }

    return expanded;
  }

  async snapshot(): Promise<{ entries: CatalogEntry[]; cursor: string }> {
    const last = this.events.at(-1);

    return { entries: [...this.entries], cursor: last?.id ?? "0" };
  }
}
