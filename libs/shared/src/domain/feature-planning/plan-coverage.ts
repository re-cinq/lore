// How much of an approved plan its spec carries: every statement that specifies a plan block ends its link group with that block's link, and the coverage check on the feature-planning line counts which blocks no statement links.

import { trailingLinkHrefs } from "../spec-link-parser.js";
import { segmentStatements } from "../spec-segment.js";

interface ViewBlock {
  id: string;
  type: string;
  text: string;
}

interface ViewSection {
  slot: string;
  blocks: ViewBlock[];
}

/** The plan as lore-api reads it for its agents (planning-document's `readView`), narrowed to what coverage reads. */
export interface PlanView {
  sections: ViewSection[];
}

export interface CitableBlock {
  id: string;
  slot: string;
  kind: string;
  text: string;
  /** What a statement cites: the plan page, anchored on the block. */
  link: string;
}

/** The file the spec writer and the coverage check read: every block of the approved plan a spec statement must cite. */
export interface CitablePlan {
  plan_url: string;
  blocks: CitableBlock[];
}

// A prototype is something to look at, a heading only names what follows it, and an answer is cited through its question.
const UNCITABLE_SLOTS = new Set(["prototype"]);
const UNCITABLE_KINDS = new Set(["heading", "answer"]);

export function citablePlan(view: PlanView, planUrl: string): CitablePlan {
  const sections = view.sections.filter(
    (section) => !UNCITABLE_SLOTS.has(section.slot),
  );

  return {
    plan_url: planUrl,
    blocks: sections.flatMap((section) => citableBlocksOf(section, planUrl)),
  };
}

function citableBlocksOf(
  section: ViewSection,
  planUrl: string,
): CitableBlock[] {
  const citable = section.blocks.filter(
    (block) => !UNCITABLE_KINDS.has(block.type) && block.text.trim() !== "",
  );

  return citable.map((block) => ({
    id: block.id,
    slot: section.slot,
    kind: block.type,
    text: block.text,
    link: `${planUrl}#${block.id}`,
  }));
}

export interface PlanCoverage {
  total: number;
  cited: number;
  missing: CitableBlock[];
}

/** Which of the plan's blocks the spec files cite. Only a statement's trailing link group counts, as for test links, and only links to this plan's page: a spec several plans amended keeps each plan's citations apart. */
export function planCoverage(
  blocks: CitableBlock[],
  specFiles: string[],
): PlanCoverage {
  const citedLinks = new Set(specFiles.flatMap(trailingLinksOf));
  const missing = blocks.filter((block) => !citedLinks.has(block.link));

  return {
    total: blocks.length,
    cited: blocks.length - missing.length,
    missing,
  };
}

function trailingLinksOf(specFile: string): string[] {
  return segmentStatements(specFile).flatMap((statement) =>
    trailingLinkHrefs(statement.text),
  );
}

/** The coverage as the spec writer's next round and the spec PR's body read it. */
export function coverageBrief({ total, cited, missing }: PlanCoverage): string {
  const summary = `${cited} of ${total} plan blocks are cited by a spec statement.`;

  if (missing.length === 0) {
    return `## Plan coverage\n\n${summary}\n`;
  }

  return [
    "## Plan coverage",
    "",
    `${summary} Not cited yet:`,
    "",
    ...missing.map(missingLine),
    "",
  ].join("\n");
}

// The whole text, on one line: a line break inside it would end the list item, and the writer needs every word of what it must specify.
function missingLine({ slot, kind, text, link }: CitableBlock): string {
  const oneLine = text.replace(/\s+/g, " ").trim();

  return `- ${slot} (${kind}): ${oneLine} — cite ${link}`;
}

/** How many times a coverage check may send its agent back before the line goes on with the gaps listed: the spec writer before the spec PR opens, decompose before the run settles. The feature-planning line's `spec-coverage → write` and `issue-coverage → decompose` edges carry the same budget as their backstop. */
export const COVERAGE_ROUNDS = 3;

interface Visit {
  nodeId: string;
  report: { outcome: string } | null;
}

// A person acting grants a fresh budget, the same way the floor's own iteration_max counts only the visits since one did.
const HUMAN_NODES = new Set(["author", "merged"]);

/** The handbacks the coverage check at `coverageNode` spent since a person last acted on the run, oldest visit first. */
export function coverageRoundsSpent(
  visits: Visit[],
  coverageNode: string,
): number {
  const lastHuman = visits.findLastIndex((visit) =>
    HUMAN_NODES.has(visit.nodeId),
  );
  const sinceLastHuman = visits.slice(lastHuman + 1);

  return sinceLastHuman.filter(
    (visit) =>
      visit.nodeId === coverageNode &&
      visit.report?.outcome === "changes_requested",
  ).length;
}
