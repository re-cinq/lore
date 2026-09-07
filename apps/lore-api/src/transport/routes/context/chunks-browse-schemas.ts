// The query params and response shapes the chunk-browse routes speak.

import { z } from "zod";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  CHUNK_COLUMNS,
  ChunkSchema,
} from "@re-cinq/lore-shared/models/chunk.js";
import { clampedLimit, offsetParam } from "../common-schemas.js";

export const ChunksQuery = z.object({
  repo: z.string().max(200).optional(),
  type: z.string().max(80).optional(),
  q: z.string().max(500).optional(),
  limit: clampedLimit.default(50),
  offset: offsetParam,
});

export type ChunksQuery = z.infer<typeof ChunksQuery>;

export const ByPathQuery = z.object({
  path: z.string().min(1).max(500),
  repo: z.string().max(200).optional(),
});

export type ByPathQuery = z.infer<typeof ByPathQuery>;

/** Chunk browse read model: content preview + rank are computed, rest derived from schema. */
export const ChunkBrowseSchema = wireSchema(
  ChunkSchema.pick({
    id: true,
    filePath: true,
    contentType: true,
    repo: true,
    metadata: true,
    content: true,
    ingestedAt: true,
  }),
  CHUNK_COLUMNS,
).extend({
  /** `ts_rank` against the search query; 0 when the caller passed none. */
  rank: z.number().optional(),
});

export const ChunkListSchema = z.object({ chunks: z.array(ChunkBrowseSchema) });

export const ChunkByPathSchema = z.object({
  chunks: z.array(
    z.object({
      id: z.string(),
      content_type: z.string().nullable(),
      content: z.string(),
      metadata: z.record(z.unknown()).nullable(),
      repo: z.string().nullable(),
    }),
  ),
});

export const ChunkTypeListSchema = z.object({ types: z.array(z.string()) });

export const ChunkSummarySchema = z.object({
  count: z.number(),
  convention_files: z.array(z.string()),
});
