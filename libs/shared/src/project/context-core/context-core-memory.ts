import type {
  ContextCorePort,
  ContextCoreRecord,
} from "./context-core-port.js";

/**
 * In-memory {@link ContextCorePort}: keeps every inserted record so tests can
 * assert what the builder wrote, and resolves {@link latest} from the
 * `production` rows it has seen (most-recent insert wins). The behavioral spec
 * for the context-core history surface.
 */
export class InMemoryContextCore implements ContextCorePort {
  readonly records: ContextCoreRecord[] = [];

  async latest(namespace: string): Promise<number | null> {
    const production = this.records.filter(
      (record) =>
        record.namespace === namespace && record.status === "production",
    );
    const newest = production[production.length - 1];

    return newest?.evalScore ?? null;
  }

  async insert(record: ContextCoreRecord): Promise<void> {
    this.records.push(record);
  }
}
