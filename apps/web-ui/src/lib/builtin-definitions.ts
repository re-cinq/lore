// Definition fixtures transcribed by hand from the builtin YAML sources, which
// web-ui cannot read (it is outside the npm workspace and the parse would need a
// YAML dependency this epic forbids). Sources, in the order declared below:
//   libs/assembly-lines/src/assembly-lines/implementation.yaml
//   libs/assembly-lines/src/assembly-lines/general.yaml
//   libs/assembly-lines/src/assembly-lines/gap-fill.yaml
//   libs/assembly-lines/src/assembly-lines/code-review.yaml
//   libs/assembly-lines/src/assembly-lines/spec-drift.yaml
//   libs/assembly-lines/src/assembly-lines/feature-planning.yaml
//   libs/assembly-lines/src/assembly-lines/feature-finalize.yaml
// Descriptions and prompt_refs are omitted; only the graph shape is under test.

import type { AssemblyLineDefinition } from "./assembly-line-definition";

export const implementationDefinition: AssemblyLineDefinition = {
  name: "implementation",
  description: "Implement a spec, validate, push, review.",
  version: 1,
  entry: "implement",
  exit: "done",
  nodes: [
    { id: "implement", type: "agent" },
    { id: "validate", type: "validate", validator: "all" },
    { id: "push", type: "agent" },
    { id: "review", type: "agent" },
    { id: "address", type: "agent" },
    { id: "retrospective", type: "retrospective" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "implement", to: "validate", on: "success" },
    { from: "implement", to: "implement", on: "failed", iteration_max: 1 },
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

export const generalDefinition: AssemblyLineDefinition = {
  name: "general",
  description: "Linear flow for general tasks.",
  version: 1,
  entry: "implement",
  exit: "done",
  nodes: [
    { id: "implement", type: "agent" },
    { id: "validate", type: "validate", validator: "all" },
    { id: "push", type: "agent" },
    { id: "review", type: "agent" },
    { id: "retrospective", type: "retrospective" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "implement", to: "validate", on: "success" },
    { from: "validate", to: "push", on: "success" },
    { from: "push", to: "review", on: "always" },
    { from: "review", to: "retrospective", on: "success" },
    { from: "review", to: "retrospective", on: "changes_requested" },
    { from: "review", to: "retrospective", on: "failed" },
    { from: "retrospective", to: "done", on: "always" },
  ],
};

export const gapFillDefinition: AssemblyLineDefinition = {
  name: "gap-fill",
  description: "Draft missing context as docs, validate, push.",
  version: 1,
  entry: "draft",
  exit: "done",
  nodes: [
    { id: "draft", type: "agent" },
    { id: "validate", type: "validate", validator: "all" },
    { id: "push", type: "agent" },
    { id: "retrospective", type: "retrospective" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "draft", to: "validate", on: "success" },
    { from: "validate", to: "push", on: "success" },
    { from: "push", to: "retrospective", on: "always" },
    { from: "retrospective", to: "done", on: "always" },
  ],
};

export const codeReviewDefinition: AssemblyLineDefinition = {
  name: "code-review",
  description: "Review a PR and emit structured findings.",
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

export const specDriftDefinition: AssemblyLineDefinition = {
  name: "spec-drift",
  description: "Per-repo spec drift detection.",
  version: 1,
  entry: "detect",
  exit: "done",
  nodes: [
    { id: "detect", type: "detect", job_ref: "spec_drift" },
    { id: "done", type: "retrospective" },
  ],
  edges: [{ from: "detect", to: "done", on: "success" }],
};

export const featurePlanningDefinition: AssemblyLineDefinition = {
  name: "feature-planning",
  description: "One interactive planning round; emits a structured GapResult.",
  version: 1,
  entry: "analyze",
  exit: "done",
  nodes: [
    { id: "analyze", type: "agent" },
    { id: "done", type: "retrospective" },
  ],
  edges: [{ from: "analyze", to: "done", on: "always" }],
};

export const featureFinalizeDefinition: AssemblyLineDefinition = {
  name: "feature-finalize",
  description: "Write the agreed spec.md, commit, and push for the spec PR.",
  version: 1,
  entry: "write",
  exit: "done",
  nodes: [
    { id: "write", type: "agent" },
    { id: "push", type: "agent" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "write", to: "push", on: "success" },
    { from: "write", to: "done", on: "changes_requested" },
    { from: "write", to: "done", on: "failed" },
    { from: "push", to: "done", on: "always" },
  ],
};

export const builtinDefinitions: AssemblyLineDefinition[] = [
  implementationDefinition,
  generalDefinition,
  gapFillDefinition,
  codeReviewDefinition,
  specDriftDefinition,
  featurePlanningDefinition,
  featureFinalizeDefinition,
];
