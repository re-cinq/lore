// PR opening for spec-coverage-backfill: branch naming, PR body rendering, and the createBranch/commitFile/open call sequence.
import type { Judgment } from "../../domain/spec-judge.js";
import type { Project } from "../../outbound/project/lib/project.js";

const PR_BRANCH_PREFIX = "lore/spec-coverage-backfill";

export function buildLabel(testFile: string, testLine: number | null): string {
  const base = testFile.split("/").pop() ?? testFile;

  return testLine
    ? `validated by \`${base}:${testLine}\``
    : `validated by \`${base}\``;
}

function buildBranchName(specPath: string): string {
  const safe = specPath
    .replace(/^specs\//, "")
    .replace(/\.md$/, "")
    .replace(/[^a-zA-Z0-9._/-]/g, "-")
    .replace(/\/+/g, "-")
    .slice(0, 60);
  // Add a short timestamp so re-runs land on distinct branches.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T-]/g, "");

  return `${PR_BRANCH_PREFIX}/${safe}-${stamp}`;
}

/** What the reviewer is actually deciding. Spelled out because the consequence is asymmetric: merging makes those tests the source of truth for the statement's coverage, while rejecting leaves it uncovered and reviewable again later. */
const WHAT_MERGING_MEANS =
  "Each suggestion adds an inline `([validated by ...](path#Lline))` parenthetical at end of a testable statement that currently has no test link. Review each — merging this PR makes the linked tests the source of truth for that statement's coverage; rejecting it leaves the statement uncovered (red in the UI) and you can write a different link in a follow-up.";

/** One line per applied suggestion, carrying the judge's SCORE and its reasoning — a reviewer deciding whether a link is right needs to see why the machine thought so. */
function rationaleLines(judgments: Judgment[], applied: number): string {
  return judgments
    .slice(0, applied)
    .map(
      (j) =>
        `- **${j.test_file}${j.test_line ? `:${j.test_line}` : ""}** (score ${j.match_score.toFixed(2)}): ${j.rationale}`,
    )
    .join("\n");
}

function buildPrBody(
  specPath: string,
  applied: number,
  judgments: Judgment[],
  diffPreview: string,
): string {
  return [
    `# Suggested test links for \`${specPath}\``,
    "",
    `${applied} suggestion${applied === 1 ? "" : "s"} for \`${specPath}\`.`,
    "",
    WHAT_MERGING_MEANS,
    "",
    "## Rationales",
    "",
    rationaleLines(judgments, applied),
    "",
    "## Diff",
    "",
    "```diff",
    diffPreview.slice(0, 8000),
    "```",
    "",
    "_Posted by Lore's `spec-coverage-backfill` cron. Re-runs weekly Mon 11:00 UTC; this PR is idempotent against later runs as long as the statement text isn't edited._",
  ].join("\n");
}

export interface OpenBackfillPrArgs {
  project: Project;
  repo: string;
  specPath: string;
  newContent: string;
  applied: number;
  confirmed: Judgment[];
  diffPreview: string;
}

/** Branch, then the edited spec on it. The branch name is derived from the spec path, so a re-run of the weekly job pushes to the same branch and updates the existing PR rather than opening a second one for the same spec. */
async function pushSpecEdit(
  project: OpenBackfillPrArgs["project"],
  branch: string,
  specPath: string,
  newContent: string,
): Promise<void> {
  await project.repo.createBranch(branch);
  await project.repo.commitFile(
    branch,
    specPath,
    newContent,
    `lore: backfill suggested test links for ${specPath}`,
  );
}

export async function openBackfillPr(
  args: OpenBackfillPrArgs,
): Promise<string | null> {
  const {
    project,
    repo,
    specPath,
    newContent,
    applied,
    confirmed,
    diffPreview,
  } = args;
  const branch = buildBranchName(specPath);

  try {
    await pushSpecEdit(project, branch, specPath, newContent);

    const pr = await project.pulls.open(branch, {
      title: `Suggested test links for ${specPath}`,
      body: buildPrBody(specPath, applied, confirmed, diffPreview),
      labels: ["lore-managed", "spec-coverage-backfill"],
    });

    return pr.url;
  } catch (err) {
    console.error(
      `[job] spec-coverage-backfill: failed to open PR for ${repo}:${specPath}:`,
      err,
    );

    return null;
  }
}
