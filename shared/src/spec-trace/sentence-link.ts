/**
 * spec-traceability-graph — sentence-match linking. A third way to link a test
 * to a spec statement (alongside inline `([validated by])` links and
 * `TestDescriptor.spec` anchors): the test's NAME carries the link as a
 * `<spec> | <sentence> | <label>` triple. The `<spec>` segment is matched as a
 * substring of the spec's H1 title and `<sentence>` as a substring of a
 * Statement/AcceptanceCriterion's text — both under shallow normalization
 * (lowercase, whitespace removed, inline link parentheticals stripped) so ragged
 * indentation and trailing links never break the match. Deterministic, zero-LLM.
 */

import type { TestDescriptor } from "../test-report.js";

/** Drops inline `([label](target))` / `[label](target)` link parentheticals so the
 *  prose matches a test name that never carried them. */
function stripLinkParens(text: string): string {
  return text.replace(/\(?\[[^\]]*\]\([^)]*\)\)?/g, "");
}

/** Shallow match key: link-parens stripped, lowercased, all whitespace removed. */
export function normalizeForMatch(text: string): string {
  return stripLinkParens(text).toLowerCase().replace(/\s+/g, "");
}

/** True when `needle` appears in `haystack` under {@link normalizeForMatch}. */
export function matchesNormalized(haystack: string, needle: string): boolean {
  const key = normalizeForMatch(needle);
  return key !== "" && normalizeForMatch(haystack).includes(key);
}

/** A test name parsed into its `<spec> | <sentence> | <label>` segments. */
export interface SentenceLink {
  spec: string;
  sentence: string;
  label: string;
}

/**
 * Parses a `<spec> | <sentence> | <label>` test name. The first two ` | `
 * segments are the spec and sentence; everything after is the label (so a label
 * may itself contain ` | `). Returns null when there are fewer than three
 * segments. Kept for hand-written single-string names; {@link sentenceLinkFromSuite}
 * is the primary, structural path.
 */
export function parseSentenceLink(testName: string): SentenceLink | null {
  const parts = testName.split(" | ");
  if (parts.length < 3) return null;
  return { spec: parts[0], sentence: parts[1], label: parts.slice(2).join(" | ") };
}

/**
 * Derives a {@link SentenceLink} from a descriptor's describe nesting:
 * `suite[0]` = spec title, `suite[1]` = the verbatim sentence, the leaf `name` =
 * label. Returns null unless there are at least two describe levels — so a plain
 * `describe(unit) > it(behavior)` unit test (suite length 1) never links. This is
 * the primary path: it's structural, so it never depends on a ` | ` vs ` > `
 * separator and a unit test can't accidentally parse as a link.
 */
export function sentenceLinkFromSuite(descriptor: TestDescriptor): SentenceLink | null {
  const suite = descriptor.suite ?? [];
  if (suite.length < 2) return null;
  return { spec: suite[0], sentence: suite[1], label: descriptor.name };
}
