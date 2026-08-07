// Content hash of a loaded assembly line definition — the drift guard behind
// `resumeFrom` (specs/fork-rerun-from-node FR4). Forking copies node rows out of
// a prior execution and replays them against the CURRENT graph, which is only
// sound while the graph is the one that produced them.
//
// Hashed over the PARSED definition, not the YAML bytes: a comment or a reflow
// must not read as drift and block every fork of every prior run. Object keys
// are sorted so a differently-ordered parse of the same definition agrees.
//
// Array order DOES participate, and deliberately: `selectEdge` falls back to
// `candidates[0]`, so when two `always` edges leave one node their order decides
// which one wins. Reordering edges can change the walk, so it has to read as drift.
//
// `description` is excluded as documentation. The exclusion is a denylist rather
// than an allowlist of semantic fields on purpose: a field added to the loader
// schema later is then hashed by default, so the guard over-refuses rather than
// silently forking across a change it never learned about.

import { createHash } from "node:crypto";
import type { AssemblyLine } from "./loader.js";

/** Prose, at any depth — reworded documentation is not a definition change. */
const IGNORED_KEYS = new Set(["description"]);

export function definitionHash(definition: AssemblyLine): string {
  return createHash("sha256").update(canonicalJson(definition)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }

  const fields = Object.entries(value)
    .filter(([k, v]) => v !== undefined && !IGNORED_KEYS.has(k))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);

  return `{${fields.join(",")}}`;
}
