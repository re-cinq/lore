// Blueprint graphs as TEST FIXTURES. Runs carry their own graph (FR6.38), so these pin shapes for tests rather than describing what ships.

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import {
  gapDetectDefinition,
  ingestDefinition,
  specCoverageBackfillDefinition,
  specCoverageValidateDefinition,
  specDriftDefinition,
} from "./definition-fixtures-internal-events";

export * from "./definition-fixtures-internal-events";

export const codeReviewDefinition: AssemblyLineDefinition = {
  name: "code-review",
  description:
    "Review a PR — assess the diff and emit structured findings; the Floor posts them as suggestion-only Conventional Comments. Fixes are human-gated via replies.",
  version: 1,
  entry: "review",
  exit: "done",
  nodes: [
    { id: "review", type: "agent" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "review", to: "done", on: "success" },
    { from: "review", to: "done", on: "changes_requested" },
    { from: "review", to: "done", on: "failed" },
  ],
};

export const codeReviewRecheckDefinition: AssemblyLineDefinition = {
  name: "code-review-recheck",
  description:
    "Fast re-check after a new push — re-assess the updated diff and emit a REVIEW_RESULT verdict so the PR's formal APPROVE / REQUEST_CHANGES tracks the fix. Cheap model, short timeout. Started per push once the deep review has run.",
  version: 1,
  entry: "recheck",
  exit: "done",
  nodes: [
    { id: "recheck", type: "agent" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "recheck", to: "done", on: "success" },
    { from: "recheck", to: "done", on: "changes_requested" },
    { from: "recheck", to: "done", on: "failed" },
  ],
};

export const codeReviewReplyDefinition: AssemblyLineDefinition = {
  name: "code-review-reply",
  description:
    "Act on a human reply to a review comment — answer in-thread, or (on approval) commit the fix. Started by the comment-triage router or a submitted review.",
  version: 1,
  entry: "reply",
  exit: "done",
  nodes: [
    { id: "reply", type: "agent" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "reply", to: "done", on: "success" },
    { from: "reply", to: "done", on: "changes_requested" },
    { from: "reply", to: "done", on: "failed" },
  ],
};

export const commentTriageDefinition: AssemblyLineDefinition = {
  name: "comment-triage",
  description:
    "Classify a human PR comment (Haiku station) and route it — the Floor reads the triage action and starts the review / address / answer follow-up (or nothing, on ignore).",
  version: 1,
  entry: "triage",
  exit: "done",
  nodes: [
    { id: "triage", type: "comment-triage" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "triage", to: "done", on: "success" },
    { from: "triage", to: "done", on: "failed" },
  ],
};

export const featurePlanningDefinition: AssemblyLineDefinition = {
  name: "feature-planning",
  description:
    "One interactive planning round: analyze the feature request against the project (with the prior feature timeline in context) and emit a structured GapResult. No commit, no PR — the run declares result.json as a produced artifact (`output.watch`), the subsystem raises it as a `planning.result` event, and the Floor persists it as the round's result.",
  // eslint-disable-next-line re-lint/no-duplicate-code -- a blueprint fixture whose literal shape is what feature-run.test.ts asserts against; the test restating it is the assertion, not a copy to be removed
  version: 1,
  entry: "analyze",
  exit: "done",
  nodes: [
    { id: "analyze", type: "agent" },
    {
      id: "author",
      type: "feature_review",
      route: "/repos/{args.repo}/features/{args.feature_id}",
    },
    { id: "analyse-specs", type: "agent" },
    { id: "write", type: "agent" },
    { id: "push", type: "agent" },
    { id: "merged", type: "pr_review", route: "{args.pr_url}" },
    { id: "decompose", type: "agent" },
    { id: "issues", type: "issues" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "analyze", to: "author", on: "success" },
    { from: "analyze", to: "author", on: "changes_requested" },
    { from: "author", to: "analyze", on: "changes_requested" },
    { from: "author", to: "analyse-specs", on: "success" },
    { from: "analyse-specs", to: "write", on: "success" },
    { from: "analyse-specs", to: "author", on: "changes_requested" },
    { from: "analyse-specs", to: "done", on: "failed" },
    { from: "write", to: "push", on: "success" },
    {
      from: "write",
      to: "analyse-specs",
      on: "changes_requested",
      iteration_max: 1,
    },
    { from: "write", to: "done", on: "failed" },
    { from: "push", to: "merged", on: "always" },
    { from: "merged", to: "decompose", on: "success" },
    { from: "merged", to: "author", on: "changes_requested" },
    { from: "merged", to: "done", on: "failed" },
    { from: "decompose", to: "issues", on: "success" },
    { from: "decompose", to: "done", on: "changes_requested" },
    { from: "decompose", to: "done", on: "failed" },
    { from: "issues", to: "done", on: "success" },
    {
      from: "issues",
      to: "decompose",
      on: "changes_requested",
      iteration_max: 1,
    },
    { from: "issues", to: "done", on: "failed" },
    { from: "author", to: "done", on: "failed" },
    { from: "analyze", to: "analyze", on: "failed", iteration_max: 1 },
  ],
};

export const gapFillDefinition: AssemblyLineDefinition = {
  name: "gap-fill",
  description:
    "Draft missing context as docs, validate, push. No human review on the auto-merge path.",
  version: 1,
  entry: "draft",
  exit: "done",
  nodes: [
    { id: "draft", type: "agent" },
    { id: "validate", type: "validate" },
    { id: "push", type: "agent" },
    { id: "retrospective", type: "retrospective" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "draft", to: "validate", on: "success" },
    { from: "draft", to: "retrospective", on: "changes_requested" },
    { from: "draft", to: "draft", on: "failed", iteration_max: 1 },
    { from: "validate", to: "push", on: "success" },
    { from: "validate", to: "draft", on: "failed", iteration_max: 1 },
    { from: "push", to: "retrospective", on: "always" },
    { from: "retrospective", to: "done", on: "always" },
  ],
};

export const generalDefinition: AssemblyLineDefinition = {
  name: "general",
  description:
    // eslint-disable-next-line re-lint/no-duplicate-code -- the general line's own description and graph; it must stay changeable without touching the implementation line's, which is why both are written out
    "Linear flow for general tasks — implement, validate, push, review, retrospective. Used when no more specific assembly line applies.",
  version: 1,
  entry: "implement",
  exit: "done",
  nodes: [
    { id: "implement", type: "agent" },
    { id: "validate", type: "validate" },
    { id: "push", type: "agent" },
    // eslint-disable-next-line re-lint/no-duplicate-code -- the general line's node list, pinned literally: a shared node table would let a change to one line silently edit the other line's expected graph
    { id: "review", type: "agent" },
    { id: "retrospective", type: "retrospective" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "implement", to: "validate", on: "success" },
    { from: "implement", to: "retrospective", on: "changes_requested" },
    // eslint-disable-next-line re-lint/no-duplicate-code -- the general line's edges, self-loop included; the implementation line's edges fork from these downstream and each set is asserted verbatim
    { from: "implement", to: "implement", on: "failed", iteration_max: 1 },
    { from: "validate", to: "push", on: "success" },
    { from: "validate", to: "implement", on: "failed", iteration_max: 1 },
    { from: "push", to: "review", on: "always" },
    { from: "review", to: "retrospective", on: "success" },
    { from: "review", to: "retrospective", on: "changes_requested" },
    { from: "review", to: "retrospective", on: "failed" },
    { from: "retrospective", to: "done", on: "always" },
  ],
};

export const implementationDefinition: AssemblyLineDefinition = {
  name: "implementation",
  description:
    // eslint-disable-next-line re-lint/no-duplicate-code -- the implementation line's description and nodes, deliberately its own literal even where it currently reads like the general line's
    "Implement a spec, validate, push, review. On changes_requested, address feedback up to 2 iterations.",
  version: 1,
  entry: "implement",
  exit: "done",
  nodes: [
    { id: "implement", type: "agent" },
    { id: "validate", type: "validate" },
    { id: "push", type: "agent" },
    { id: "review", type: "agent" },
    // eslint-disable-next-line re-lint/no-duplicate-code -- the implementation line's node list, kept separate so adding a node here cannot move the general line's expected graph
    { id: "address", type: "agent" },
    { id: "retrospective", type: "retrospective" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "implement", to: "validate", on: "success" },
    { from: "implement", to: "implement", on: "failed", iteration_max: 1 },
    // eslint-disable-next-line re-lint/no-duplicate-code -- the implementation line's edges, which fork from the general line's at changes_requested; each fixture states its whole graph rather than a diff
    { from: "implement", to: "retrospective", on: "changes_requested" },
    { from: "validate", to: "push", on: "success" },
    { from: "validate", to: "implement", on: "failed", iteration_max: 1 },
    { from: "push", to: "review", on: "always" },
    { from: "review", to: "retrospective", on: "success" },
    {
      from: "review",
      to: "address",
      on: "changes_requested",
      iteration_max: 2,
    },
    { from: "address", to: "validate", on: "always", iteration_max: 2 },
    { from: "review", to: "retrospective", on: "failed" },
    { from: "retrospective", to: "done", on: "always" },
  ],
};

export const builtinDefinitions: AssemblyLineDefinition[] = [
  codeReviewDefinition,
  codeReviewRecheckDefinition,
  codeReviewReplyDefinition,
  commentTriageDefinition,
  featurePlanningDefinition,
  gapDetectDefinition,
  gapFillDefinition,
  generalDefinition,
  implementationDefinition,
  ingestDefinition,
  specCoverageBackfillDefinition,
  specCoverageValidateDefinition,
  specDriftDefinition,
];
