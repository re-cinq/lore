import { z } from "zod";
import type { IssueRef } from "@re-cinq/lore-shared/project/lib/github-port.js";
import { implementationEvidenceSchema } from "@re-cinq/lore-shared/feature-planning/grounding.js";
import type { ImplementationProject } from "./deps.js";

export const ISSUE_SCOPE_PATH = "issue-scope.md";
export const ISSUE_SCOPE_LINE = 5;

export const issueSnapshotSchema = z.object({
  repo: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  commit: z.string().regex(/^[0-9a-f]{40}$/i),
});

export type IssueSnapshot = z.infer<typeof issueSnapshotSchema>;

export const behavioralProofSchema = z.object({
  line: z.literal(ISSUE_SCOPE_LINE),
  test_id: z.string().min(1),
  evidence: implementationEvidenceSchema,
  reason: z.string().trim().min(1),
});

export type BehavioralProof = z.infer<typeof behavioralProofSchema>;

export function issueSnapshot(issue: IssueRef, commit: string): IssueSnapshot {
  return issueSnapshotSchema.parse({
    repo: issue.repo,
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    commit,
  });
}

export function issueScope(snapshot: IssueSnapshot): string {
  const report = `${snapshot.title}\n${snapshot.body}`.replace(/\r?\n/g, " ");

  return `# Issue assessment\n\n## Requirements\n\n- The implementation MUST satisfy this entire issue report: ${report}\n`;
}

export const verifiedCompletionSchema = z.object({
  snapshot: issueSnapshotSchema,
  message: z.string().min(1),
  proofs: z.array(behavioralProofSchema).min(1),
});

export type VerifiedCompletion = z.infer<typeof verifiedCompletionSchema>;

export async function currentIssue(
  snapshot: IssueSnapshot,
  project: ImplementationProject,
  loaded?: IssueRef,
): Promise<boolean> {
  const issue = loaded ?? (await project.issues.get(snapshot.number));
  const head = await project.repo.headSha(await project.repo.defaultBranch());

  return matchesReport(snapshot, issue) && head === snapshot.commit;
}

function matchesReport(
  snapshot: IssueSnapshot,
  issue: IssueRef | null,
): boolean {
  if (!issue) {
    return false;
  }
  const expected = ["open", snapshot.title, snapshot.body];

  return [issue.state, issue.title, issue.body ?? ""].every(
    (value, index) => value === expected[index],
  );
}
