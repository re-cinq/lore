// PR opening for spec-coverage-backfill: branch naming, PR body rendering, and the createBranch/commitFile/open call sequence.
import type { Judgment, Project } from "../index.js";

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

function buildPrBody(
  specPath: string,
  applied: number,
  judgments: Judgment[],
  diffPreview: string,
): string {
  const summary = `${applied} suggestion${applied === 1 ? "" : "s"} for \`${specPath}\``;
  const rationales = judgments
    .slice(0, applied)
    .map(
      (j) =>
        `- **${j.test_file}${j.test_line ? `:${j.test_line}` : ""}** (score ${j.match_score.toFixed(2)}): ${j.rationale}`,
    )
    .join("\n");

  return [
    `# Suggested test links for \`${specPath}\``,
    "",
    summary + ".",
    "",
    "Each suggestion adds an inline `([validated by ...](path#Lline))` parenthetical at end of a testable statement that currently has no test link. Review each — merging this PR makes the linked tests the source of truth for that statement's coverage; rejecting it leaves the statement uncovered (red in the UI) and you can write a different link in a follow-up.",
    "",
    "## Rationales",
    "",
    rationales,
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
  const title = `Suggested test links for ${specPath}`;
  const body = buildPrBody(specPath, applied, confirmed, diffPreview);

  try {
    await project.repo.createBranch(branch);
    await project.repo.commitFile(
      branch,
      specPath,
      newContent,
      `lore: backfill suggested test links for ${specPath}`,
    );
    const pr = await project.pulls.open(branch, {
      title,
      body,
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
