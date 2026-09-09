// What a feature request ASKS FOR — one prompt per generated artifact. Separate from handle-feature-request.ts, which decides how the branch and PR are built: these are edited far more often than that is.

import { slugify } from "./task-helpers.js";

/** The sections this org's specs carry, in the order a reader expects them. */
const SPEC_SECTIONS = `- Problem Statement (what problem does this solve for users?)
- Vision (what does the end state look like?)
- User Scenarios & Acceptance Criteria (concrete flows with testable criteria)
- Functional Requirements (numbered, testable)
- Non-Functional Requirements (performance, security if relevant)
- Out of Scope (what this does NOT include)
- Key Entities (data model implications)
- Success Criteria (measurable outcomes)
- Assumptions`;

/** The spec itself: the sections this org's specs carry, plus a real example from the repo so the generated file matches the house format rather than a generic template. */
function specPrompt(
  featureSlug: string,
  pmIntent: string,
  existingSpecExample: string,
): { path: string; prompt: string } {
  return {
    path: `specs/${featureSlug}/spec.md`,
    prompt: `Write a feature specification for the following product request.

The PM said: "${pmIntent}"

Write a proper engineering spec with these sections:
${SPEC_SECTIONS}

Match the conventions and style of this repository. Be specific to the actual tech stack and architecture described in CLAUDE.md.${existingSpecExample}`,
  };
}

/** The data model, which a feature may legitimately not need — the prompt says so, and a declined file is skipped rather than failing the run. */
function dataModelPrompt(
  featureSlug: string,
  pmIntent: string,
): { path: string; prompt: string } {
  return {
    path: `specs/${featureSlug}/data-model.md`,
    prompt: `Based on this feature request, define the data model changes needed.

The PM said: "${pmIntent}"

If the feature requires new tables, fields, or relationships, document them with:
- Table name, fields, types, constraints
- Relationships to existing entities
- Migration notes

If no data model changes are needed, respond with just "SKIP".

Look at the existing schema in CLAUDE.md and any existing data models for conventions.`,
  };
}

/** The task breakdown that later becomes spec-task rows; phase ordering here is what the dependency inference reads. */
function tasksPrompt(
  featureSlug: string,
  pmIntent: string,
): { path: string; prompt: string } {
  return {
    path: `specs/${featureSlug}/tasks.md`,
    prompt: `Create a task breakdown for implementing this feature.

The PM said: "${pmIntent}"

Generate tasks in checklist format:
- [ ] T001 [P] Description with file path
- [ ] T002 Description with file path

Organize into phases:
- Phase 1: Setup (project scaffolding, dependencies)
- Phase 2: Core (main implementation)
- Phase 3: Integration (wiring, testing, polish)

Mark parallelizable tasks with [P]. Include file paths based on the actual project structure visible in the repo context. Each task must be specific enough for an engineer (or AI agent) to execute without additional context.`,
  };
}

/** The three artifacts a feature request becomes, and what each one asks for. */
export function specFilePrompts(
  pmIntent: string,
  existingSpecExample: string,
): { path: string; prompt: string }[] {
  const featureSlug = slugify(pmIntent);

  return [
    specPrompt(featureSlug, pmIntent, existingSpecExample),
    dataModelPrompt(featureSlug, pmIntent),
    tasksPrompt(featureSlug, pmIntent),
  ];
}
