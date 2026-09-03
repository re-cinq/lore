import { z } from "zod";
import type { ColumnMap } from "../lib/row.js";

/** `memory.snapshots` — a point-in-time capture of which memories an agent held; `memoryRefs` stores references rather than copies, so a snapshot doesn't pin values against decay. */

export const SnapshotSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  memoryRefs: z.unknown(),
  trigger: z.string(),
  createdAt: z.date(),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;

export const SNAPSHOT_COLUMNS = {
  id: "id",
  agentId: "agent_id",
  memoryRefs: "memory_refs",
  trigger: "trigger",
  createdAt: "created_at",
} as const satisfies ColumnMap<Snapshot>;

export const SNAPSHOT_TABLE = "memory.snapshots";
