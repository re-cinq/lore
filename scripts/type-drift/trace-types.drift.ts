/**
 * Compile-time drift guard for the test-link ref mirror.
 *
 * apps/web-ui cannot import @re-cinq/lore-shared (npm-workspace exclusion +
 * isolated Docker build context), so the shape of a parsed
 * `[label](path#Lline)` coverage link is hand-mirrored as `TestLinkRef` in
 * apps/web-ui/src/lib/trace-types.ts (canonical: `SpecLinkRef` in the shared
 * spec-link parser). This file makes `npm run typecheck:drift` go red the
 * moment either side gains or retypes a field the other lacks.
 */

import type { SpecLinkRef } from "../../libs/shared/src/spec-link-parser.js";

import type { TestLinkRef } from "../../apps/web-ui/src/lib/trace-types.js";

type StructEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : { MIRROR_HAS_EXTRA_OR_RETYPED: B }
  : { MIRROR_IS_MISSING_OR_RETYPED: A };

export const _testLinkRef: StructEqual<SpecLinkRef, TestLinkRef> = true;
