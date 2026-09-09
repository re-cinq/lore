// The internal-event family of fixture graphs (detect + ingest): one deterministic station, no PR.

import type { AssemblyLineDefinition } from "./assembly-line-definition";

export const gapDetectDefinition: AssemblyLineDefinition = {
  name: "gap-detect",
  description:
    // eslint-disable-next-line re-lint/no-duplicate-code -- the gap-detect line fixture; every detection line is pinned whole because the tests assert the graph a reader sees, not a template that generated it
    "Per-repo documentation gap detection; files gap-fill tasks for missing context.",
  version: 1,
  entry: "detect",
  exit: "done",
  nodes: [
    { id: "detect", type: "detect" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "detect", to: "done", on: "success" },
    { from: "detect", to: "done", on: "failed" },
  ],
};

export const ingestDefinition: AssemblyLineDefinition = {
  name: "ingest",
  description:
    "One internal.ingest.* payload projected into the spec-traceability graph by an ingest station pod (specs/ingest-station FR2).",
  version: 1,
  entry: "ingest",
  exit: "done",
  nodes: [
    { id: "ingest", type: "ingest" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "ingest", to: "done", on: "success" },
    { from: "ingest", to: "done", on: "failed" },
  ],
};

export const specCoverageBackfillDefinition: AssemblyLineDefinition = {
  name: "spec-coverage-backfill",
  description:
    // eslint-disable-next-line re-lint/no-duplicate-code -- the spec-coverage-backfill line fixture, stated in full; the four detection lines differ only in name and prose today and must stay able to differ in shape
    "Per-repo spec-coverage backfill; judges un-linked testable statements and opens link-suggestion PRs.",
  version: 1,
  entry: "detect",
  exit: "done",
  nodes: [
    { id: "detect", type: "detect" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "detect", to: "done", on: "success" },
    { from: "detect", to: "done", on: "failed" },
  ],
};

export const specCoverageValidateDefinition: AssemblyLineDefinition = {
  name: "spec-coverage-validate",
  description:
    // eslint-disable-next-line re-lint/no-duplicate-code -- the spec-coverage-validate line fixture; folding the four into one generated table would have the tests assert the generator instead of the graph
    "Per-repo validation of inline spec→test links; files spec-link-rot issues for broken links.",
  version: 1,
  entry: "detect",
  exit: "done",
  nodes: [
    { id: "detect", type: "detect" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "detect", to: "done", on: "success" },
    { from: "detect", to: "done", on: "failed" },
  ],
};

export const specDriftDefinition: AssemblyLineDefinition = {
  name: "spec-drift",
  description:
    // eslint-disable-next-line re-lint/no-duplicate-code -- the spec-drift line fixture; its detect node and prose are its own, and this literal is what the run-graph tests compare against
    "Per-repo spec drift detection (graph-primary, heuristic fallback); files gap-fill tasks for drifted specs.",
  version: 1,
  entry: "detect",
  exit: "done",
  nodes: [
    { id: "detect", type: "detect" },
    { id: "done", type: "retrospective" },
  ],
  edges: [
    { from: "detect", to: "done", on: "success" },
    { from: "detect", to: "done", on: "failed" },
  ],
};
