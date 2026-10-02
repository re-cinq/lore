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

export const featurePlanningDefinition: AssemblyLineDefinition = {
  name: "feature-planning",
  description:
    "A plan from its first draft to its spec-tasks: the agent drafts the plan people write together, each Refine sends one section back to it, and approval moves the plan on to its spec PR and decomposition.",
  version: 1,
  entry: "analyze",
  exit: "done",
  nodes: [
    { id: "analyze", type: "agent" },
    {
      id: "author",
      type: "feature_review",
      route: "/repos/{args.repo}/plans/{args.plan_id}",
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

// The graph of the `implementation` line, deleted on 2026-10-01 (#2328). Kept as a fixture because runs that walked it are still stored with this graph and the run page still draws them.
export const implementationDefinition: AssemblyLineDefinition = {
  name: "implementation",
  description:
    "Implement a spec, validate, push, review. On changes_requested, address feedback up to 2 iterations.",
  version: 1,
  entry: "implement",
  exit: "done",
  nodes: [
    { id: "implement", type: "agent" },
    { id: "validate", type: "validate" },
    { id: "push", type: "agent" },
    { id: "review", type: "agent" },
    { id: "address", type: "agent" },
    { id: "retrospective", type: "retrospective" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "implement", to: "validate", on: "success" },
    { from: "implement", to: "implement", on: "failed", iteration_max: 1 },
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
  featurePlanningDefinition,
  gapDetectDefinition,
  gapFillDefinition,
  implementationDefinition,
  ingestDefinition,
  specCoverageBackfillDefinition,
  specCoverageValidateDefinition,
  specDriftDefinition,
];
