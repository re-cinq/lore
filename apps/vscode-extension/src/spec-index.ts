/**
 * Pure core: build the `source-file → highlighted ranges` index the editor
 * decorations and hovers render from.
 *
 * Two layers, merged with local precedence (the user's rule: an inline link in
 * a spec.md sentence is the source of truth, the graph is only consulted for
 * what the markdown does not already state):
 *   - "implemented" — authored inline `([code|validated by](file#Lnn))` links
 *     parsed straight from the local spec.md. Precise, evidence "human-linked".
 *   - "covered"     — coverage ranges the remote spec graph attributes to a
 *     spec-linked test (the `Coverage.covers|ranges` facet). Denser, evidence
 *     "execution-verified".
 *
 * No vscode imports — fully unit-testable with real spec strings + graph values.
 */

import type { SpecGraph, SpecGraphNode } from "@re-cinq/lore-shared";
import { parseCodeLinksInStatement, parseTestLinksInStatement, type SpecLinkRef } from "@re-cinq/lore-shared/spec-link-parser.js";
import { segmentStatements } from "@re-cinq/lore-shared/spec-segment.js";
import { parseRangesFacet } from "./coverage-ranges.js";

export type HighlightLayer = "implemented" | "covered";

export interface LinkTarget {
  label: string;
  /** Repo-relative file path. */
  path: string;
  /** 1-based line from a `#Lnn` anchor, or null when absent. */
  line: number | null;
}

export interface RangeEntry {
  /** 1-based inclusive range in the target file. */
  startLine: number;
  endLine: number;
  layer: HighlightLayer;
  evidence: "human-linked" | "execution-verified";
  /** The spec statement this range fulfils (cleaned of its trailing link soup). */
  statementText: string;
  specPath: string;
  /** 1-based line in the spec where the statement's link sits, or 0 if unknown. */
  specLine: number;
  /** The statement's other artifacts — tests for a code line, code for a test line. */
  related: LinkTarget[];
}

/** source-file relative path → ranges that highlight inside it. */
export type SpecCodeIndex = Map<string, RangeEntry[]>;

export interface SpecSource {
  path: string;
  content: string;
}

function toTarget(ref: SpecLinkRef): LinkTarget {
  return { label: ref.label, path: ref.path, line: ref.line };
}

function addEntry(index: SpecCodeIndex, path: string, entry: RangeEntry): void {
  const existing = index.get(path);
  if (existing) existing.push(entry);
  else index.set(path, [entry]);
}

/** Drop the trailing `([…](…))` link parenthetical so the hover shows prose. */
function cleanStatementText(text: string): string {
  const marker = text.indexOf(" ([");
  return (marker >= 0 ? text.slice(0, marker) : text).trim();
}

/** 1-based line of the first ref whose `path#Lnn` anchor appears in the spec. */
function locateStatementLine(lines: string[], refs: SpecLinkRef[]): number {
  for (const ref of refs) {
    const needle = ref.line !== null ? `${ref.path}#L${ref.line}` : ref.path;
    const idx = lines.findIndex((line) => line.includes(needle));
    if (idx >= 0) return idx + 1;
  }
  return 0;
}

/** Parse local spec.md files into the implemented layer — inline code links
 * highlight the source line, inline test links highlight the test line, each
 * cross-linked to the statement's other artifacts. */
export function buildLocalIndex(specs: SpecSource[]): SpecCodeIndex {
  const index: SpecCodeIndex = new Map();
  for (const spec of specs) {
    const lines = spec.content.split(/\r?\n/);
    for (const statement of segmentStatements(spec.content)) {
      const codeLinks = parseCodeLinksInStatement(statement.text);
      const testLinks = parseTestLinksInStatement(statement.text);
      if (codeLinks.length === 0 && testLinks.length === 0) continue;

      const statementText = cleanStatementText(statement.text);
      const specLine = locateStatementLine(lines, [...codeLinks, ...testLinks]);
      const codeTargets = codeLinks.map(toTarget);
      const testTargets = testLinks.map(toTarget);

      for (const link of codeLinks) {
        if (link.line === null) continue;
        addEntry(index, link.path, {
          startLine: link.line, endLine: link.line,
          layer: "implemented", evidence: "human-linked",
          statementText, specPath: spec.path, specLine, related: testTargets,
        });
      }
      for (const link of testLinks) {
        if (link.line === null) continue;
        addEntry(index, link.path, {
          startLine: link.line, endLine: link.line,
          layer: "implemented", evidence: "human-linked",
          statementText, specPath: spec.path, specLine, related: codeTargets,
        });
      }
    }
  }
  return index;
}

/** Walk the remote spec graph into the coverage layer: for every
 * Statement → validated_by Test → covers File chain, attribute the File's
 * covered intervals back to the statement. */
export function buildCoverageIndex(graph: SpecGraph): SpecCodeIndex {
  const index: SpecCodeIndex = new Map();
  const nodeById = new Map<string, SpecGraphNode>(graph.nodes.map((n) => [n.id, n]));

  const statementByTest = new Map<string, SpecGraphNode>();
  for (const link of graph.links) {
    if (link.kind !== "validated_by") continue;
    const stmt = nodeById.get(link.source);
    if (stmt) statementByTest.set(link.target, stmt);
  }

  for (const link of graph.links) {
    if (link.kind !== "covers") continue;
    const test = nodeById.get(link.source);
    const file = nodeById.get(link.target);
    const stmt = statementByTest.get(link.source);
    if (!test || !file?.path || !stmt) continue;

    const related: LinkTarget[] = test.path
      ? [{ label: test.label, path: test.path, line: test.line ?? null }]
      : [];
    for (const interval of parseRangesFacet(file.detail)) {
      addEntry(index, file.path, {
        startLine: interval.startLine, endLine: interval.endLine,
        layer: "covered", evidence: "execution-verified",
        statementText: (stmt.detail ?? "").trim(),
        specPath: stmt.path ?? "", specLine: 0, related,
      });
    }
  }
  return index;
}

/** Merge with local precedence: a coverage entry is dropped when an inline
 * entry already exists for the same (statement, target file). */
export function mergeIndexes(local: SpecCodeIndex, coverage: SpecCodeIndex): SpecCodeIndex {
  const merged: SpecCodeIndex = new Map();
  for (const [path, entries] of local) merged.set(path, [...entries]);

  for (const [path, entries] of coverage) {
    const localEntries = local.get(path);
    for (const entry of entries) {
      if (localEntries?.some((e) => e.statementText === entry.statementText)) continue;
      addEntry(merged, path, entry);
    }
  }
  return merged;
}
