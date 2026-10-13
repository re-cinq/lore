/** Projection addressing context + small hashing helpers shared by project-spec-file.ts and project-spec-file-nodes.ts. */

import { createHash } from "node:crypto";
import type { DgraphClientPort } from "../../outbound/spec-trace/deps.js";

/** Embeds a file's statement/criterion texts in one go, one vector (or null) per text in input order; injected as a seam so projection stays deterministic + offline in tests. One call per file rather than per statement: a 100 KB spec embedded statement by statement outran its station's deadline. */
export type EmbedFn = (texts: string[]) => Promise<Array<number[] | null>>;

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
  /** The vector the file's single embed call returned for this text. */
  embeddingOf: (text: string) => number[] | null;
}

/** Hex sha256 — the content-hash idiom shared by Spec, Statement, and AcceptanceCriterion nodes. */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
