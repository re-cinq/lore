/**
 * Pure spec-side projection: per spec.md line that carries inline coverage
 * links, the test + code targets to surface as a CodeLens. Drives the
 * bidirectional half of the extension (statement → tests/code), and stays in
 * lock-step with the web-UI by reusing the same shared link parsers.
 */

import {
  parseCodeLinksInStatement,
  parseTestLinksInStatement,
  type SpecLinkRef,
} from "@re-cinq/lore-shared/spec-link-parser.js";
import type { LinkTarget } from "./spec-index.js";

export interface SpecLens {
  /** 0-based line index, ready for a vscode.Range. */
  line: number;
  tests: LinkTarget[];
  code: LinkTarget[];
}

function toTarget(ref: SpecLinkRef): LinkTarget {
  return { label: ref.label, path: ref.path, line: ref.line };
}

export function specLenses(content: string): SpecLens[] {
  const lenses: SpecLens[] = [];
  content.split(/\r?\n/).forEach((text, line) => {
    const tests = parseTestLinksInStatement(text).map(toTarget);
    const code = parseCodeLinksInStatement(text).map(toTarget);
    if (tests.length > 0 || code.length > 0) lenses.push({ line, tests, code });
  });
  return lenses;
}
