/**
 * Compile-time drift guard for the feature-planning type mirror.
 *
 * apps/web-ui CANNOT import @re-cinq/lore-shared — it is excluded from the npm
 * workspace and built in an isolated Docker context (context = apps/web-ui only),
 * and shared drags in Anthropic SDK / dgraph / tree-sitter. So the canonical
 * feature-planning types are hand-mirrored in apps/web-ui/src/lib/feature-types.ts.
 *
 * This file makes that mirror's drift a hard failure: `npm run typecheck:drift`
 * (tsc --noEmit) goes red the moment a canonical shared type gains a key — or a
 * status union changes — that the mirror does not carry. It is type-only
 * (everything erases) and is NEVER bundled into the web app.
 */

import type {
  GapResult as CanonGapResult,
  GapSection as CanonGapSection,
  GapQuestion as CanonGapQuestion,
  GapMockup as CanonGapMockup,
  SectionDirection as CanonSectionDirection,
} from "../../libs/shared/src/feature-planning/gap-result.js";
import type { SectionAnswers as CanonSectionAnswers } from "../../libs/shared/src/feature-planning/planning-prompt.js";
import type {
  FeatureStatus as CanonFeatureStatus,
  IterationStatus as CanonIterationStatus,
} from "../../libs/shared/src/project/features/features-port.js";

import type {
  GapResult as MirrorGapResult,
  GapSection as MirrorGapSection,
  GapQuestion as MirrorGapQuestion,
  GapMockup as MirrorGapMockup,
  SectionDirection as MirrorSectionDirection,
  SectionAnswers as MirrorSectionAnswers,
  FeatureStatus as MirrorFeatureStatus,
  IterationStatus as MirrorIterationStatus,
} from "../../apps/web-ui/src/lib/feature-types.js";

// Every canonical key must exist on the mirror (extra legacy keys on the mirror are
// fine). Resolves to `true` on success, else to an error object that `= true` rejects.
type KeysCovered<Canon, Mirror> = keyof Canon extends keyof Mirror
  ? true
  : { MIRROR_MISSING_KEYS: Exclude<keyof Canon, keyof Mirror> };

// Status unions must match exactly, in both directions.
type UnionEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : { UNION_MIRROR_HAS_EXTRA: Exclude<B, A> }
  : { UNION_MIRROR_IS_MISSING: Exclude<A, B> };

export const _gapResult: KeysCovered<CanonGapResult, MirrorGapResult> = true;
export const _gapSection: KeysCovered<CanonGapSection, MirrorGapSection> = true;
export const _gapQuestion: KeysCovered<CanonGapQuestion, MirrorGapQuestion> = true;
export const _gapMockup: KeysCovered<CanonGapMockup, MirrorGapMockup> = true;
export const _sectionAnswers: KeysCovered<CanonSectionAnswers, MirrorSectionAnswers> = true;

export const _featureStatus: UnionEqual<CanonFeatureStatus, MirrorFeatureStatus> = true;
export const _iterationStatus: UnionEqual<CanonIterationStatus, MirrorIterationStatus> = true;
export const _sectionDirection: UnionEqual<CanonSectionDirection, MirrorSectionDirection> = true;
