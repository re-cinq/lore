import type {
  ContextCorePort,
  ContextCoreRecord,
} from "./context-core-port.js";

/** In-memory {@link ContextCorePort}: keeps inserted records, resolves latest from `production` rows. */
export class InMemoryContextCore implements ContextCorePort {
  readonly records: ContextCoreRecord[] = [];

  async latest(namespace: string): Promise<number | null> {
    const production = this.records.filter(
      (record) =>
        record.namespace === namespace && record.status === "production",
    );
    const newest = production.at(-1);

    return newest?.evalScore ?? null;
  }

  async insert(record: ContextCoreRecord): Promise<void> {
    this.records.push(record);
  }
}
