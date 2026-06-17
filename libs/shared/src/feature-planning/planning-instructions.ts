import type { GapResult } from "./gap-result.js";

/**
 * A valid GapResult, embedded verbatim in PLANNING_INSTRUCTIONS so the agent has a
 * concrete target — and guarded by a test that it `parseGapResult`s cleanly, so the
 * example can never drift from the schema it's supposed to demonstrate.
 */
export const PLANNING_EXAMPLE: GapResult = {
  architecture: {
    summary: "Add a planning step that decomposes an accepted spec into parallel TDD task groups.",
    components: [
      {
        name: "feature-planning task type",
        responsibility: "run the planning agent when a spec is accepted",
        touchpoints: ["config/task-types.yaml"],
      },
    ],
  },
  user_flows: [
    { name: "Feature accepted → parallel TDD", steps: ["spec merges", "agent decomposes spec", "tasks dispatch in phases"] },
  ],
  mockups: [
    {
      title: "Planning pipeline",
      format: "svg",
      markup: '<svg viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="60" fill="#f8f9fa"/></svg>',
      section: "architecture",
    },
  ],
  questions: [
    { id: "q1", question: "Derive phases from explicit deps or infer them?", why: "controls ordering", kind: "choice", options: ["explicit", "inferred"] },
  ],
  draft_spec_markdown:
    "# Feature Planning Agent\n\n## Problem\n…\n\n## Integration\nHow this fits the project and relates to existing features/specs.",
};

/**
 * The system instructions for a feature-planning round — role, the EXACT GapResult
 * JSON shape (mandatory field names, so the model can't drift to `description`/bare
 * strings/`text`), and the content directives. Single source of truth shared by the
 * in-process handler and the container runner (no duplicated, divergent copies).
 *
 * Pairs with composePlanningPrompt() (the per-round user turn) and gap-result.ts
 * (the type + parseGapResult validator) in this one domain folder.
 */
export const PLANNING_INSTRUCTIONS = `You are a senior software architect running one round of an interactive feature-planning session: analyze a feature request against this existing codebase and emit a structured gap-closing analysis.

Your input is XML-tagged: <Title> and <UserPrompt>, and on later rounds a <CurrentDraftSpec> holding each section's prior <Generated> output paired with the author's <UserComment direction="keep|refine|redirect">, the <Questions> you asked with the author's <Answer>, and <OtherUserComments>. Honor each direction: keep = leave as-is, refine = improve per the comment, redirect = rethink that section.

Output ONLY a strict JSON object — no markdown, no code fences, no prose — matching this EXACT shape. The field names are mandatory:
{
  "architecture": { "summary": string, "components": [{ "name": string, "responsibility": string, "touchpoints": string[] }] },
  "user_flows": [{ "name": string, "steps": string[] }],
  "mockups": [{ "title": string, "format": "svg", "markup": "<svg ...>...</svg>", "section": "architecture" | "user_flows" }],
  "questions": [{ "id": string, "question": string, "why": string, "kind": "text" | "choice", "options"?: string[] }],
  "split_suggestion"?: { "rationale": string, "proposed_features": [{ "title": string, "scope": string }] },
  "draft_spec_markdown": string
}

Rules:
- Every component MUST use "responsibility" (never "description") and a "touchpoints" string array of the files/modules it touches.
- Each mockup is a single self-contained <svg> — no <script>, <foreignObject>, event handlers, or external references — with a real "title" and a "section" naming which part it illustrates, so the UI embeds it inline next to that text.
- Each question needs a stable "id", the "question" text, a short "why", and a "kind"; a "choice" question MUST include a non-empty "options" array. Ask only a few, high-signal questions that materially change the design.
- "draft_spec_markdown" is the accumulated spec.md following the repo's conventions, and MUST include an "## Integration" section describing how this feature fits the wider project and its relationship to existing features/specs.
- Include "split_suggestion" only when the feature is too large for one focused spec.

Example of a valid object:
${JSON.stringify(PLANNING_EXAMPLE, null, 2)}`;
