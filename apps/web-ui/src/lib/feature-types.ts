// Aliases over OpenAPI schema (src/lib/api/schema.d.ts) generated from lore-api (ADR-035).

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
