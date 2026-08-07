// Content hash of a loaded assembly line definition — the drift guard behind
// `resumeFrom` (specs/fork-rerun-from-node FR4). Forking copies node rows out of
// a prior execution and replays them against the CURRENT graph, which is only
// sound while the graph is the one that produced them.
//
// Hashed over the PARSED definition, not the YAML bytes: a comment or a reflow
// must not read as drift and block every fork of every prior run. Object keys
// are sorted so a differently-ordered parse of the same definition agrees;
// array order is content, since it is what the author wrote.

import { createHash } from "node:crypto";
import type { AssemblyLine } from "./loader.js";

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
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);

  return `{${fields.join(",")}}`;
}
