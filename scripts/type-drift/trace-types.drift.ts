// Drift guard: web-ui can't import @re-cinq/lore-shared, so SpecLinkRef is hand-mirrored as TestLinkRef in web-ui/src/lib/trace-types.ts.

import type { SpecLinkRef } from "../../libs/shared/src/spec-link-parser.js";

import type { TestLinkRef } from "../../apps/web-ui/src/lib/trace-types.js";

type StructEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : { MIRROR_HAS_EXTRA_OR_RETYPED: B }
  : { MIRROR_IS_MISSING_OR_RETYPED: A };

export const _testLinkRef: StructEqual<SpecLinkRef, TestLinkRef> = true;
