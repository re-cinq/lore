import type { IssueCollection } from "../../outbound/project/issues/issues.js";
import type { PullRequests } from "../../outbound/project/pulls/pull-requests.js";
import type {
  PullRef,
  IssueComment,
} from "../../outbound/project/pulls/pull-requests-port.js";

export const REVIEW_PROGRESS_MARKER = "<!-- lore:shadow-review-progress:v1 ";

export interface ReviewProgressProject {
  pulls: Pick<PullRequests, "get">;
  issues: Pick<IssueCollection, "listComments" | "comment" | "updateComment">;
}

type ProgressVersion = {
  runId: string;
  startedAt: number;
  stage: number;
};

export type ReviewProgress = ProgressVersion & {
  prNumber: number;
  headSha: string;
  appLogin: string;
  body: string;
};

/** The caller serializes publishers for a PR. The current head is read immediately before a write. */
export async function publishReviewProgress(
  { pulls, issues }: ReviewProgressProject,
  progress: ReviewProgress,
  signal?: AbortSignal,
): Promise<void> {
  const { prNumber, headSha } = progress;
  const body = markedBody(progress);
  const existing = await findOwned(issues, progress);

  if (existing && keepExisting(existing, progress, body)) {
    return;
  }
  const pull = await pulls.get(prNumber);

  signal?.throwIfAborted();

  if (matchesOpenHead(pull, headSha)) {
    await writeProgress(issues, progress, body, existing);
  }
}

function matchesOpenHead(pull: PullRef | null, headSha: string): boolean {
  return pull?.state === "open" && pull.headSha === headSha;
}

function markedBody({ runId, startedAt, stage, body }: ReviewProgress): string {
  return `${REVIEW_PROGRESS_MARKER}${runId} ${startedAt} ${stage} -->\n${body}`;
}

async function findOwned(
  issues: ReviewProgressProject["issues"],
  { prNumber, appLogin }: ReviewProgress,
): Promise<IssueComment | undefined> {
  const comments = await issues.listComments(prNumber);

  return comments.find(
    ({ user, body }) =>
      user.toLowerCase() === appLogin.toLowerCase() && versionOf(body),
  );
}

function keepExisting(
  existing: IssueComment,
  progress: ReviewProgress,
  body: string,
): boolean {
  const version = versionOf(existing.body);

  return (
    existing.body === body ||
    (version !== undefined && !precedes(version, progress))
  );
}

async function writeProgress(
  issues: ReviewProgressProject["issues"],
  progress: ReviewProgress,
  body: string,
  existing: IssueComment | undefined,
): Promise<void> {
  if (existing) {
    await issues.updateComment(existing.id, body);

    return;
  }

  try {
    await issues.comment(progress.prNumber, body);
  } catch (error) {
    // GitHub may have created the comment before the response was lost.
    if ((await findOwned(issues, progress))?.body !== body) {
      throw error;
    }
  }
}

function versionOf(body: string): ProgressVersion | undefined {
  const header = body.split("\n", 1)[0];
  const match =
    /^<!-- lore:shadow-review-progress:v1 ([a-zA-Z0-9-]+) (\d+) (\d+) -->$/.exec(
      header,
    );

  if (match) {
    const [, runId, startedAt, stage] = match;

    return { runId, startedAt: Number(startedAt), stage: Number(stage) };
  }
}

function precedes(current: ProgressVersion, next: ProgressVersion): boolean {
  if (current.runId === next.runId) {
    return current.stage <= next.stage;
  }

  return (
    current.startedAt < next.startedAt ||
    (current.startedAt === next.startedAt && current.runId < next.runId)
  );
}
