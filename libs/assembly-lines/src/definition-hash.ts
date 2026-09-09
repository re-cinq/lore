// Content hash of a loaded assembly line — drift guard behind `resumeFrom` (specs/fork-rerun-from-node FR4), hashed over the PARSED definition with sorted keys (array order DOES participate, since selectEdge's candidates[0] fallback means edge order can change the walk) and `description` denylisted so a new loader field hashes — and over-refuses — by default.

import { createHash } from "node:crypto";
import type { AssemblyLine } from "./loader.js";

// Prose, at any depth — reworded documentation is not a definition change.
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
