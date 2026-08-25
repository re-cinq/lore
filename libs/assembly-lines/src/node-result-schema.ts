/**
 * Runtime validation for {@link NodeResult}.
 *
 * The interface was enough while a node result only ever existed in-process: a
 * pod printed it on stdout and the Floor parsed it under its own eye. Since a
 * station can report a node's outcome over `assembly_run.resume`, the shape
 * crosses a process boundary as JSON — the same point at which StationInput was
 * given a schema rather than a cast.
 *
 * Deliberately strict about `extras`. Its values are rendered into stage-commit
 * trailers and read by the walk (a triage node's whole output is
 * `extras.action`), so a non-string that reached a trailer as `[object Object]`
 * would be a silent loss of the decision the node was run to make.
 */

import { z } from "zod";
import type { NodeResult } from "./node-types.js";

const OUTCOME = z.enum(["success", "changes_requested", "failed"]);

/** Mirrors FailureCategory in @re-cinq/lore-shared/error-classify. */
const FAILURE_CLASS = z.enum([
  "anthropic-credit",
  "anthropic-rate-limit",
  "github-workflows-permission",
  "github-permission",
  "auth",
  "infra",
  "unknown",
]);

/** Every field required, mirroring NodeLlmUsage: a parse DROPS what it does not
 *  declare, so an optional-everything schema would quietly discard a node's
 *  reported cost on the way across. */
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
  usage: USAGE.optional(),
  failureClass: FAILURE_CLASS.optional(),
  failureDetail: z.string().optional(),
});

/**
 * Compile-time proof that the schema and the interface still describe each
 * other, asserted BOTH ways on purpose. One direction alone passes while the
 * schema is looser than the interface — which is the dangerous direction, since
 * a parse silently drops every field it does not declare.
 */
export type ParsedNodeResult = z.infer<typeof NodeResultSchema>;
const _schemaAcceptsResult: ParsedNodeResult = {} as NodeResult;
const _resultAcceptsSchema: NodeResult = {} as ParsedNodeResult;

void _schemaAcceptsResult;
void _resultAcceptsSchema;
