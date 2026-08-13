// The feature-planning shapes, as aliases over the OpenAPI document lore-api
// generates from its own route contracts (ADR-035).
//
// This file used to be 162 lines of hand-written interfaces kept honest by a
// bespoke type-only compile (scripts/type-drift/feature-types.drift.ts). The
// mirror is gone: `src/lib/api/schema.d.ts` is generated from
// `apps/lore-api/openapi.json`, and `scripts/check-openapi-drift.sh` fails CI when
// either artifact is stale. The aliases keep every importer's names unchanged.
//
// Some shapes are reached structurally rather than by component name: only the
// top-level response contracts are registered as named components, and the gap
// shapes ride inside an iteration.

import type { components } from "./api/schema";

export type Feature = components["schemas"]["Feature"];
/** The legacy name, kept because 15 files import it. */
export type FeatureRow = Feature;
export type FeatureWithIterations =
  components["schemas"]["FeatureWithIterations"];
export type FeatureIterationRow = FeatureWithIterations["iterations"][number];

export type FeatureStatus = Feature["status"];
export type IterationStatus = FeatureIterationRow["status"];

export type GapResult = NonNullable<FeatureIterationRow["gap_result"]>;
export type GapSection = NonNullable<GapResult["sections"]>[number];
export type GapMockup = NonNullable<GapSection["mockups"]>[number];
export type GapQuestion = NonNullable<GapSection["questions"]>[number];

export type SectionAnswers = NonNullable<FeatureIterationRow["user_answers"]>;
export type SectionDirection = NonNullable<
  NonNullable<SectionAnswers["sections"]>[string]["direction"]
>;
