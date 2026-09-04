import type { Assert, KeysAreColumns } from "../../lib/row.js";
import {
  MEMORY_ENTRY_COLUMNS,
  type MemoryEntry,
} from "../../models/memory-entry.js";
import { FACT_COLUMNS, type Fact } from "../../models/fact.js";
import { EPISODE_COLUMNS, type Episode } from "../../models/episode.js";

// ── In-memory row shapes (modelling the memory.* tables) ─────────────

/** A `memory.memories` row the double tracks. Defaults match the table. */
export interface MemoryLifecycleRow {
  id: string;
  agent_id: string;
  key: string;
  value: string;
  version: number;
  is_deleted: boolean;
  created_at: string;
  last_retrieved_at: string | null;
  half_life_days: number | null;
  retrieval_count: number | null;
  expires_at: string | null;
}

/** A memory.facts row the double tracks; agent_id/repo are NOT real columns (a fact reaches its agent through its memory/episode) — flattened here for seeding, the Pg adapter must reproduce them by joining. */
export interface FactRow {
  id: string;
  agent_id: string;
  fact_text: string;
  repo: string;
  valid_to: string | null;
  confidence: string;
  created_at: string;
  last_retrieved_at: string | null;
  half_life_days: number | null;
}

/** A `memory.episodes` row the double tracks. */
export interface EpisodeRow {
  id: string;
  agent_id: string;
  content: string;
  content_hash: string;
  source: string;
  ref: string;
}

// The double's rows ARE the tables' rows — type-only assertion so tsc fails the moment a shape here drifts from the table (else a 42703 passes both the in-memory and SQL halves green).

type _MemoryRowKeysAreColumns = Assert<
  KeysAreColumns<MemoryLifecycleRow, MemoryEntry, typeof MEMORY_ENTRY_COLUMNS>
>;

// agent_id/repo are the documented exceptions (produced by joining, not a real column) — listing them here makes a silently-added third exception a build failure.
type _FactRowKeysAreColumns = Assert<
  KeysAreColumns<Omit<FactRow, "agent_id" | "repo">, Fact, typeof FACT_COLUMNS>
>;

type _EpisodeRowKeysAreColumns = Assert<
  KeysAreColumns<EpisodeRow, Episode, typeof EPISODE_COLUMNS>
>;
