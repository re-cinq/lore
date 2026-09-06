import { z } from "zod";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  SharedPoolSchema,
  SHARED_POOL_COLUMNS,
} from "@re-cinq/lore-shared/models/shared-pool.js";
import {
  MemoryEntrySchema,
  MEMORY_ENTRY_COLUMNS,
} from "@re-cinq/lore-shared/models/memory-entry.js";
import {
  EpisodeSchema,
  EPISODE_COLUMNS,
} from "@re-cinq/lore-shared/models/episode.js";
import { clampedLimit, offsetParam } from "../common-schemas.js";

// Request + response shapes for memory browse reads (ADR-032), shaped per SCREEN not per table.

export const GraphBrowseQuery = z.object({
  entity: z.string().max(200).optional(),
  type: z.string().max(80).optional(),
  show_invalid: z.coerce.boolean().optional(),
});

export type GraphBrowseQuery = z.infer<typeof GraphBrowseQuery>;

export const EpisodesQuery = z.object({
  source: z.string().max(40).optional(),
  agent: z.string().max(200).optional(),
  limit: clampedLimit.default(50),
  offset: offsetParam,
});

export type EpisodesQuery = z.infer<typeof EpisodesQuery>;

export const MemorySearchQuery = z.object({
  q: z.string().min(1).max(500),
});

export type MemorySearchQuery = z.infer<typeof MemorySearchQuery>;

export const MemoriesQuery = z.object({
  agent: z.string().min(1).max(200),
  limit: clampedLimit.default(100),
});

export type MemoriesQuery = z.infer<typeof MemoriesQuery>;

// Read models share stored fields with a model (renamed column can't drift) plus COMPUTED fields no table holds.
const PoolSchema = wireSchema(SharedPoolSchema, SHARED_POOL_COLUMNS);

export const PoolListSchema = z.object({
  pools: z.array(
    PoolSchema.extend({
      entry_count: z.number(),
      agent_count: z.number(),
    }),
  ),
});

export const PoolDetailSchema = z.object({
  pool: PoolSchema,
  entries: z.array(
    wireSchema(
      MemoryEntrySchema.pick({
        id: true,
        key: true,
        value: true,
        agentId: true,
        version: true,
        createdAt: true,
      }),
      MEMORY_ENTRY_COLUMNS,
    ),
  ),
});

export const EpisodePageSchema = z.object({
  episodes: z.array(
    wireSchema(
      EpisodeSchema.pick({
        id: true,
        agentId: true,
        source: true,
        ref: true,
        createdAt: true,
      }),
      EPISODE_COLUMNS,
    ).extend({
      /** First 300 chars; not nullable — `LEFT()` of a NOT NULL column always yields a string. */
      content_preview: z.string(),
      fact_count: z.number(),
    }),
  ),
  total: z.number(),
});

// Read models, not raw rows: `edges` joins to NAMES, and stays empty unless an entity is selected (costliest query).
export const GraphBrowseSchema = z.object({
  stats: z.object({
    entity_count: z.number(),
    active_edge_count: z.number(),
    invalidated_edge_count: z.number(),
  }),
  entity_types: z.array(z.object({ entity_type: z.string(), cnt: z.number() })),
  entities: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      entity_type: z.string(),
      repo: z.string().nullable(),
      updated_at: z.string(),
      edge_count: z.number(),
    }),
  ),
  edges: z.array(
    z.object({
      source_name: z.string(),
      source_type: z.string(),
      relation_type: z.string(),
      target_name: z.string(),
      target_type: z.string(),
      valid_from: z.string(),
      valid_to: z.string().nullable(),
      source_label: z.string(),
    }),
  ),
});

/** Memories and facts, ranked together — the two carry different fields. */
export const MemorySearchSchema = z.object({
  results: z.array(z.record(z.unknown())),
});

/** One agent's memories, each with its version history and extracted facts. */
export const MemoryListSchema = z.object({
  memories: z.array(z.record(z.unknown())),
});
