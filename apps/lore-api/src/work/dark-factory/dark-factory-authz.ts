import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { Octokit } from "octokit";
import { standingApprovers } from "./approval-reviews.js";
import {
  isCodeowner,
  isTeamOnlyOwners,
  APPROVED_PATH,
  ownersOfPath,
  parseCodeowners,
  type CodeownersRow,
} from "./codeowners.js";

export { isCodeowner };

export const APPROVAL_LABEL = "dark-factory-approval";

export interface ApprovalEvidence {
  /** "owner/repo#42" form, from the X-Lore-Approval-PR header. */
  prRef: string;
  /** GitHub login of the CLAUDE.md owner who applied the label or whose review approval stands. */
  approver: string;
  /** PR URL, recorded in the audit log. */
  prUrl: string;
}

export class TwoKeyError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "missing_header"
      | "invalid_pr_ref"
      | "pr_not_found"
      | "pr_state"
      | "label_missing"
      | "approver_not_codeowner"
      | "team_membership_unresolved"
      | "codeowners_unparseable"
      | "github_api"
      | "wrong_repo",
  ) {
    super(message);
    this.name = "TwoKeyError";
  }
}

const PR_REF_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

type PullRequest = Awaited<ReturnType<Octokit["rest"]["pulls"]["get"]>>;
type IssueEvents = Awaited<ReturnType<Octokit["rest"]["issues"]["listEvents"]>>;
type LabelEvent = IssueEvents["data"][number];
const EVENTS_PAGE_SIZE = 100;

export interface PrLookup {
  octokit: Octokit;
  owner: string;
  repo: string;
  number: number;
  prRef: string;
}

interface RepoRef {
  octokit: Octokit;
  owner: string;
  repo: string;
}

const CODEOWNERS_CANDIDATES = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
];

/** Verify the approval ceremony; returns evidence or throws TwoKeyError. Approval PR must match targetRepo (FR3.9). */
export async function verifyApproval(opts: {
  octokit: Octokit;
  prRef: string;
  targetRepo: string; // "owner/repo"
}): Promise<ApprovalEvidence> {
  const { octokit, prRef, targetRepo } = opts;
  const { owner, repo, number } = parsePrRef(prRef);

  enforceSameRepo(prRef, `${owner}/${repo}`, targetRepo);

  const target = { octokit, owner, repo, number, prRef };
  const pr = await fetchOpenApprovalPr(target);
  const labeler = await resolveLabelApprover(target, pr);
  const approver = await resolveApprover(target, targetRepo, labeler);

  return { prRef, approver, prUrl: pr.data.html_url };
}

export function parsePrRef(ref: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const m = ref.match(PR_REF_RE);

  enforceTrue(
    m,
    (message) => new TwoKeyError(message, "invalid_pr_ref"),
    `Invalid PR reference "${ref}" — expected owner/repo#N`,
  );

  return { owner: m[1], repo: m[2], number: Number.parseInt(m[3], 10) };
}

/** The approval must be on the repo being changed. An approval PR against a DIFFERENT repo would satisfy the ceremony while nobody who owns this code had seen it. */
function enforceSameRepo(
  prRef: string,
  prRepo: string,
  targetRepo: string,
): void {
  if (prRepo !== targetRepo) {
    throw new TwoKeyError(
      `Approval PR ${prRef} is against ${prRepo}, not ${targetRepo}`,
      "wrong_repo",
    );
  }
}

/** The approval PR, which must still be OPEN. A merged or closed PR would let one approval authorize changes indefinitely; requiring it open is what makes the ceremony a live decision rather than a past one. */
async function fetchOpenApprovalPr(target: {
  octokit: Octokit;
  owner: string;
  repo: string;
  number: number;
  prRef: string;
}) {
  const pr = await fetchApprovalPr(target);

  if (pr.data.state !== "open") {
    throw new TwoKeyError(
      `Approval PR ${target.prRef} is ${pr.data.state}; ceremony requires open PR`,
      "pr_state",
    );
  }

  return pr;
}

async function fetchApprovalPr({
  octokit,
  owner,
  repo,
  number,
  prRef,
}: PrLookup): Promise<PullRequest> {
  const { pulls } = octokit.rest;

  try {
    return await pulls.get({ owner, repo, pull_number: number });
  } catch (err) {
    throwApprovalPrFetchError(err, prRef);
  }
}

/** Every failure to read the approval PR is fatal and never degrades into "unapproved": a 404 is reported as a missing PR, anything else as an opaque API error, so a transient GitHub outage can never be mistaken for a completed ceremony. */
function throwApprovalPrFetchError(err: unknown, prRef: string): never {
  enforceTrue(
    (err as { status?: number }).status !== 404,
    (message) => new TwoKeyError(message, "pr_not_found"),
    `Approval PR ${prRef} not found`,
  );
  throw new TwoKeyError(
    `GitHub API error fetching ${prRef}: ${(err as Error).message}`,
    "github_api",
  );
}

/** The label's most recent applier, read from the issue-events log: the label's presence alone names nobody. Undefined when the log shows no live application, which only a CLAUDE.md owner's review approval can still satisfy. */
async function resolveLabelApprover(
  target: PrLookup,
  pr: PullRequest,
): Promise<string | undefined> {
  const { octokit, owner, repo, number, prRef } = target;

  const { labels } = pr.data;

  enforceTrue(
    labels.some((label) => label.name === APPROVAL_LABEL),
    (message) => new TwoKeyError(message, "label_missing"),
    `Approval label "${APPROVAL_LABEL}" missing on PR ${prRef}`,
  );

  const labelEvent = findApprovalLabelEvent(
    await fetchApprovalEvents(octokit.rest.issues, owner, repo, number),
  );

  return (labelEvent?.actor as { login?: string } | null | undefined)?.login;
}

async function fetchApprovalEvents(
  issues: Octokit["rest"]["issues"],
  owner: string,
  repo: string,
  number: number,
): Promise<LabelEvent[]> {
  try {
    return await listAllEvents(issues, { owner, repo, issue_number: number });
  } catch (err) {
    throw new TwoKeyError(
      `GitHub API error fetching events: ${(err as Error).message}`,
      "github_api",
    );
  }
}

async function listAllEvents(
  issues: Octokit["rest"]["issues"],
  target: { owner: string; repo: string; issue_number: number },
): Promise<LabelEvent[]> {
  const events: LabelEvent[] = [];

  for (let page = 1; ; page++) {
    const res = await issues.listEvents({
      ...target,
      per_page: EVENTS_PAGE_SIZE,
      page,
    });

    events.push(...res.data);

    if (res.data.length < EVENTS_PAGE_SIZE) {
      return events;
    }
  }
}

function findApprovalLabelEvent(events: LabelEvent[]): LabelEvent | undefined {
  let current: LabelEvent | undefined;

  for (const e of events) {
    const labelled = e as unknown as { label?: { name?: string } };

    if (labelled.label?.name !== APPROVAL_LABEL) {
      continue;
    }

    if (e.event === "labeled") {
      current = e;
    }

    if (e.event === "unlabeled") {
      current = undefined;
    }
  }

  return current;
}

/** The label is the live-decision marker; the second key is then either its applier owning CLAUDE.md or a CLAUDE.md owner whose latest review of the PR is still an approval. */
async function resolveApprover(
  target: PrLookup,
  targetRepo: string,
  labeler: string | undefined,
): Promise<string> {
  const codeowners = await fetchCodeowners(target);

  if (labeler !== undefined && isCodeowner(labeler, codeowners)) {
    return labeler;
  }

  const reviewer = (await fetchApprovers(target)).find((login) =>
    isCodeowner(login, codeowners),
  );

  return reviewer ?? throwUnapproved(target, targetRepo, labeler, codeowners);
}

async function fetchApprovers(target: PrLookup): Promise<string[]> {
  try {
    return await standingApprovers(target);
  } catch (err) {
    throw new TwoKeyError(
      `GitHub API error fetching reviews: ${(err as Error).message}`,
      "github_api",
    );
  }
}

function throwUnapproved(
  target: PrLookup,
  targetRepo: string,
  labeler: string | undefined,
  codeowners: CodeownersRow[],
): never {
  enforceTrue(
    labeler !== undefined,
    (message) => new TwoKeyError(message, "label_missing"),
    `Approval label "${APPROVAL_LABEL}" missing on PR ${target.prRef}`,
  );

  return throwApproverRejected({ codeowners, approver: labeler, targetRepo });
}

/** Fetch CODEOWNERS file (.github/, root, docs/); returns [pattern, owners[]] or empty array. */
async function fetchCodeowners(ref: RepoRef): Promise<CodeownersRow[]> {
  for (const filepath of CODEOWNERS_CANDIDATES) {
    const text = await readCodeownersCandidate(ref, filepath);

    if (text !== undefined) {
      return parseCodeowners(text);
    }
  }

  return [];
}

/** Only a 404 may be swallowed — it just means this candidate path is not the one. Any OTHER read failure is fatal, because a CODEOWNERS we cannot read must never degrade into "this repo has no owners". */
async function readCodeownersCandidate(
  ref: RepoRef,
  filepath: string,
): Promise<string | undefined> {
  try {
    return await fetchRepoFileText(ref, filepath);
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return undefined;
    }
    throw new TwoKeyError(
      `CODEOWNERS unparseable: ${(err as Error).message}`,
      "codeowners_unparseable",
    );
  }
}

/** Undefined covers "no decodable file here" — a directory or a non-base64 payload is not a CODEOWNERS file, so the caller moves on to the next candidate path. */
async function fetchRepoFileText(
  ref: RepoRef,
  path: string,
): Promise<string | undefined> {
  const { octokit, owner, repo } = ref;
  const { repos } = octokit.rest;
  const res = await repos.getContent({ owner, repo, path });
  const file = res.data;

  return "content" in file && file.encoding === "base64"
    ? Buffer.from(file.content, "base64").toString("utf-8")
    : undefined;
}

/** Reached only when the approver did not match; the team-handle case is refused under its OWN code first, because reporting it as "not a codeowner" would blame the approver for a lookup this checker does not implement. */
function throwApproverRejected(rejection: {
  codeowners: CodeownersRow[];
  approver: string;
  targetRepo: string;
}): never {
  const { codeowners, approver, targetRepo } = rejection;

  enforceTrue(
    !isTeamOnlyOwners(ownersOfPath(APPROVED_PATH, codeowners)),
    (message) => new TwoKeyError(message, "team_membership_unresolved"),
    `${targetRepo}'s CODEOWNERS owns ${APPROVED_PATH} through team handles only (e.g. @org/team); ` +
      `team-membership lookup is not implemented in v1. Add an explicit ` +
      `@user owner for the approver, or wait for the per-path team ` +
      `resolution follow-up.`,
  );
  throw new TwoKeyError(
    `${approver} is not a CODEOWNERS member of ${targetRepo}`,
    "approver_not_codeowner",
  );
}
