// Why each rule: specs/7-feature-planning FR-21.

import { withoutTrailingLinkGroup } from "../spec-link-parser.js";
import { segmentStatements, type Statement } from "../spec-segment.js";

export type SoundnessRule = "compound-requirement" | "unbacked-criterion";

export interface SoundnessFinding {
  path: string;
  line: number;
  rule: SoundnessRule;
  statement: string;
  detail: string;
}

export interface SpecText {
  path: string;
  text: string;
}

const REQUIREMENT = /^\*\*(?:FR|CR)[-\d.]*\d\*\*/;
const CRITERION = /^\*\*SC-?[-\d.]*\d\*\*/;
const MUST = /\bMUST\b/g;
const BACKTICKED = /`([^`\n]{2,80})`/g;

export function specSoundness(
  specs: readonly SpecText[],
): SoundnessFinding[] {
  return specs.flatMap((spec) => specFindings(spec));
}

function specFindings(spec: SpecText): SoundnessFinding[] {
  return segmentStatements(spec.text).flatMap((statement) => [
    ...compoundRequirement(spec, statement),
    ...unbackedCriterion(spec, statement),
  ]);
}

// A task covers a statement by its line, so half a compound requirement counts as the whole.
function compoundRequirement(
  spec: SpecText,
  statement: Statement,
): SoundnessFinding[] {
  const said = withoutTrailingLinkGroup(statement.text);
  const musts = REQUIREMENT.test(said) ? [...said.matchAll(MUST)].length : 0;

  return musts < 2
    ? []
    : [
        finding(spec, statement, "compound-requirement", {
          detail: `carries ${musts} MUSTs; split it so each requirement is one statement a task can cover on its own`,
        }),
      ];
}

// A criterion measuring a state nothing defines cannot be computed once the line runs.
function unbackedCriterion(
  spec: SpecText,
  statement: Statement,
): SoundnessFinding[] {
  const said = withoutTrailingLinkGroup(statement.text);

  if (!CRITERION.test(said)) {
    return [];
  }
  const named = [...said.matchAll(BACKTICKED)].map(([, name]) => name);
  const defined = named.filter((name) => definedElsewhere(spec, statement, name));

  return named.length > 0 && defined.length > 0
    ? []
    : [finding(spec, statement, "unbacked-criterion", unbackedDetail(named))];
}

function unbackedDetail(named: readonly (string | undefined)[]): {
  detail: string;
} {
  return {
    detail:
      named.length === 0
        ? "names nothing measurable; name the state, label or record it is counted from, and define that in a requirement"
        : `names ${named.join(", ")}, which no other statement of this spec defines`,
  };
}

function definedElsewhere(
  spec: SpecText,
  statement: Statement,
  name: string | undefined,
): boolean {
  if (!name) {
    return false;
  }

  return segmentStatements(spec.text)
    .filter((other) => other.ordinal !== statement.ordinal)
    .some((other) => other.text.includes(`\`${name}\``));
}

function finding(
  spec: SpecText,
  statement: Statement,
  rule: SoundnessRule,
  { detail }: { detail: string },
): SoundnessFinding {
  return {
    path: spec.path,
    line: statement.line ?? 0,
    rule,
    statement: withoutTrailingLinkGroup(statement.text),
    detail,
  };
}

const HEADINGS: Record<SoundnessRule, string> = {
  "compound-requirement": "## Compound requirements",
  "unbacked-criterion": "## Unbacked success criteria",
};

export function soundnessBrief(
  findings: readonly SoundnessFinding[],
): string {
  return (Object.keys(HEADINGS) as SoundnessRule[])
    .map((rule) => section(rule, findings))
    .filter((text) => text.length > 0)
    .join("");
}

function section(
  rule: SoundnessRule,
  findings: readonly SoundnessFinding[],
): string {
  const named = findings.filter((found) => found.rule === rule);

  if (named.length === 0) {
    return "";
  }
  const bullets = named.map(bulletOf).join("\n");

  return `\n\n${HEADINGS[rule]}\n\n${bullets}\n`;
}

function bulletOf(found: SoundnessFinding): string {
  return `- ${found.path} line ${found.line}: ${excerptOf(found.statement)} — ${found.detail}`;
}

function excerptOf(statement: string): string {
  return statement.length > 120 ? `${statement.slice(0, 120)}…` : statement;
}
