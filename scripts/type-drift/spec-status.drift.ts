// Drift guard: web-ui can't import @re-cinq/lore-shared, so StatusBucket is hand-mirrored as SpecStatus; parse behavior stays in sync via spec-status.parity.test.ts.

import type { StatusBucket as CanonBucket } from "../../libs/shared/src/spec-status.js";

import type { SpecStatus as MirrorStatus } from "../../apps/web-ui/src/lib/spec-status.js";

type UnionEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : { UNION_MIRROR_HAS_EXTRA: Exclude<B, A> }
  : { UNION_MIRROR_IS_MISSING: Exclude<A, B> };

export const _statusBucket: UnionEqual<CanonBucket, MirrorStatus> = true;
