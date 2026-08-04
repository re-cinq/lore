/**
 * Compile-time drift guard for the doc-status mirror.
 *
 * apps/web-ui cannot import @re-cinq/lore-shared (npm-workspace exclusion +
 * isolated Docker build context), so the status buckets behind the spec/ADR
 * pill are hand-mirrored in apps/web-ui/src/lib/spec-status.ts (as
 * `SpecStatus`; canonical is `StatusBucket` feeding the require-statement-links
 * lint tier). This file makes `npm run typecheck:drift` go red the moment
 * either union gains a member the other lacks. Parse behaviour (the BUCKETS
 * regexes + pill labels) is value-level and is held in lockstep by
 * apps/web-ui/src/lib/spec-status.parity.test.ts instead.
 */

import type { StatusBucket as CanonBucket } from "../../libs/shared/src/spec-status.js";

import type { SpecStatus as MirrorStatus } from "../../apps/web-ui/src/lib/spec-status.js";

type UnionEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : { UNION_MIRROR_HAS_EXTRA: Exclude<B, A> }
  : { UNION_MIRROR_IS_MISSING: Exclude<A, B> };

export const _statusBucket: UnionEqual<CanonBucket, MirrorStatus> = true;
