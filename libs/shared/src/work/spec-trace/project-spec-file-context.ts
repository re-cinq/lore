/** Projection addressing context + small hashing helpers shared by project-spec-file.ts and project-spec-file-nodes.ts. */

import { createHash } from "node:crypto";
import type { DgraphClientPort } from "./deps.js";

/** Embeds a statement/criterion's text into its node's float32vector; injected as a seam so projection stays deterministic + offline in tests. */
export type EmbedFn = (text: string) => Promise<number[] | null>;

/** Dgraph float32vector literal: the array serialized as a `"[a,b,c]"` string. */
export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/** Fixed addressing context for one spec-file projection, threaded into each per-facet projector instead of a four-arg prefix. */
export interface ProjectionContext {
  dgraph: DgraphClientPort;
  repo: string;
  filePath: string;
  specUid: string;
  embed: EmbedFn;
}

/** Hex sha256 — the content-hash idiom shared by Spec, Statement, and AcceptanceCriterion nodes. */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
