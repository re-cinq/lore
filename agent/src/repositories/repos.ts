import { query } from "../platform/db.js";

export type TrustLevel = "docs" | "tests" | "implementation" | "full";

export interface ReposRepository {
  /** The configured trust level for a repo, or undefined when unset. */
  trustLevel(repo: string): Promise<TrustLevel | undefined>;
}

export class PgReposRepository implements ReposRepository {
  async trustLevel(repo: string): Promise<TrustLevel | undefined> {
    try {
      const rows = await query<{ settings: { trust?: { level?: string } } }>(
        `SELECT settings FROM lore.repos WHERE full_name = $1`,
        [repo],
      );
      return rows[0]?.settings?.trust?.level as TrustLevel | undefined;
    } catch {
      return undefined;
    }
  }
}

/** In-memory test double seeded with a repo → trust-level map. */
export class InMemoryReposRepository implements ReposRepository {
  constructor(public levels: Record<string, TrustLevel> = {}) {}

  async trustLevel(repo: string): Promise<TrustLevel | undefined> {
    return this.levels[repo];
  }
}
