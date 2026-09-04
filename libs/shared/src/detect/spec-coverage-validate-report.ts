/** Renders spec-coverage-validate's broken links into a size-budgeted `spec-link-rot` issue body. */

import type { BrokenLink } from "./spec-coverage-validate.js";

/** GitHub rejects issue bodies over 65,536 chars; leave headroom for the footer. */
const MAX_ISSUE_BODY = 60_000;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function sectionBulletsWithinBudget(
  list: BrokenLink[],
  startBudget: number,
): { bullets: string[]; sectionBudget: number; elided: number } {
  const bullets: string[] = [];
  let sectionBudget = startBudget;
  let elided = 0;

  for (const b of list) {
    const where = `\`${b.link.path}${b.link.line ? `:${b.link.line}` : ""}\``;
    const bullet = `- **${b.reason}** ${where} — referenced by: _${truncate(b.statement_text, 80)}_`;

    if (sectionBudget + bullet.length > MAX_ISSUE_BODY) {
      elided += 1;
      continue;
    }
    bullets.push(bullet);
    sectionBudget += bullet.length + 1;
  }

  return { bullets, sectionBudget, elided };
}

function groupBrokenLinksBySpec(
  broken: BrokenLink[],
): Map<string, BrokenLink[]> {
  const bySpec = new Map<string, BrokenLink[]>();

  for (const b of broken) {
    const list = bySpec.get(b.spec_path) ?? [];

    list.push(b);
    bySpec.set(b.spec_path, list);
  }

  return bySpec;
}

function pluralSuffix(count: number): string {
  return count === 1 ? "" : "s";
}

function reportHeaderLines(broken: BrokenLink[], specCount: number): string[] {
  return [
    "**Broken or misplaced test links detected**",
    "",
    `${broken.length} link${pluralSuffix(broken.length)} across ${specCount} spec${pluralSuffix(specCount)} don't resolve to a known test chunk or sit outside the trailing parenthetical.`,
    "",
  ];
}

interface SpecSectionsResult {
  lines: string[];
  elided: number;
}

// Whole bullets only, up to the budget — a raw slice could cut mid-line and drop the footer.
function renderSpecSections(
  bySpec: Map<string, BrokenLink[]>,
  startBudget: number,
): SpecSectionsResult {
  const lines: string[] = [];
  let budget = startBudget;
  let elided = 0;

  for (const [specPath, list] of bySpec) {
    const heading = `### \`${specPath}\``;

    if (budget + heading.length > MAX_ISSUE_BODY) {
      elided += list.length;
      continue;
    }

    const section = sectionBulletsWithinBudget(
      list,
      budget + heading.length + 2,
    );

    elided += section.elided;

    // Every bullet was elided — a dangling empty heading would misread as a clean spec.
    if (section.bullets.length === 0) {
      continue;
    }
    lines.push(heading, "", ...section.bullets, "");
    budget = section.sectionBudget + 1;
  }

  return { lines, elided };
}

export function formatBrokenLinksReport(broken: BrokenLink[]): string {
  if (broken.length === 0) {
    return "";
  }
  const bySpec = groupBrokenLinksBySpec(broken);
  const lines = reportHeaderLines(broken, bySpec.size);
  const sections = renderSpecSections(bySpec, lines.join("\n").length);

  lines.push(...sections.lines);

  if (sections.elided > 0) {
    lines.push(
      `_…and ${sections.elided} more broken link(s) truncated — see the job logs._`,
    );
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "Posted by Lore's `spec-coverage-validate` job. Fix or remove the broken links to silence this.",
  );

  return lines.join("\n");
}
