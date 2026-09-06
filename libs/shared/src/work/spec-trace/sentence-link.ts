/** sentence-match linking: a third way to link test→spec statement (alongside inline `([validated by])` links and `TestDescriptor.spec` anchors), via the test NAME carrying a `<spec> | <sentence> | <label>` triple matched as normalized substrings. Deterministic, zero-LLM. */

import type { TestDescriptor } from "../test-report.js";

/** Drops inline `([label](target))` / `[label](target)` link parentheticals so prose matches a test name that never carried them. */
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

/** Parses a `<spec> | <sentence> | <label>` test name (label may itself contain ` | `); null under three segments. Kept for hand-written names — {@link sentenceLinkFromSuite} is the primary, structural path. */
export function parseSentenceLink(testName: string): SentenceLink | null {
  const parts = testName.split(" | ");

  if (parts.length < 3) {
    return null;
  }

  return {
    spec: parts[0],
    sentence: parts[1],
    label: parts.slice(2).join(" | "),
  };
}

/** Derives a {@link SentenceLink} from describe nesting (`suite[0]`=spec title, `suite[1]`=sentence, leaf `name`=label); null under two describe levels, so a plain unit test never links. The primary, structural path. */
export function sentenceLinkFromSuite(
  descriptor: TestDescriptor,
): SentenceLink | null {
  const suite = descriptor.suite ?? [];

  if (suite.length < 2) {
    return null;
  }

  return { spec: suite[0], sentence: suite[1], label: descriptor.name };
}
