// Runtime validation for NodeResult: since a station can report a node's outcome over `assembly_run.resume`, the shape now crosses a process boundary as JSON (same reasoning that gave StationInput a schema). Strict about `extras` — a non-string reaching a trailer as `[object Object]` would silently lose the node's decision.

import { z } from "zod";
import type { NodeResult } from "./node-types.js";
import { FAILURE_CATEGORIES } from "@re-cinq/lore-shared/error-classify.js";

const OUTCOME = z.enum(["success", "changes_requested", "failed"]);

// DERIVED from FailureCategory, not copied — a mirror drifts the moment a class is added, and zod drops what it doesn't declare, so drift would erase the new class rather than fail.
const FAILURE_CLASS = z.enum(FAILURE_CATEGORIES);

// Every field required, mirroring NodeLlmUsage: a parse DROPS what it doesn't declare, so an optional-everything schema would quietly discard reported cost.
const USAGE = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
  model: z.string(),
});

export const NodeResultSchema = z.object({
  outcome: OUTCOME,
  extras: z.record(z.string(), z.string()).optional(),
  args: z.record(z.string(), z.string()).optional(),
  usage: USAGE.optional(),
  failureClass: FAILURE_CLASS.optional(),
  failureDetail: z.string().optional(),
});

// Compile-time proof the schema and interface still describe each other, asserted BOTH ways: one direction alone passes while the schema is looser (the dangerous direction, since a parse silently drops undeclared fields).
export type ParsedNodeResult = z.infer<typeof NodeResultSchema>;
const _schemaAcceptsResult: ParsedNodeResult = {} as NodeResult;
const _resultAcceptsSchema: NodeResult = {} as ParsedNodeResult;

void _schemaAcceptsResult;
void _resultAcceptsSchema;
