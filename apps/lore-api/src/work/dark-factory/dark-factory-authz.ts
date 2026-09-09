import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { Octokit } from "octokit";

export const APPROVAL_LABEL = "dark-factory-approval";

export interface ApprovalEvidence {
  /** "owner/repo#42" form, from the X-Lore-Approval-PR header. */
  prRef: string;
  /** GitHub login of the user who applied the approval label. */
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

interface PrLookup {
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
  const approver = await resolveLabelApprover(target);

  await enforceApproverIsCodeowner({
    octokit,
    owner,
    repo,
    targetRepo,
    approver,
  });

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

/** The approver is whoever APPLIED the label, read from the issue-events log: the label's presence alone names nobody, and the ceremony has to attribute the approval to an account it can then check against CODEOWNERS. */
async function resolveLabelApprover(target: PrLookup): Promise<string> {
  const { octokit, owner, repo, number, prRef } = target;
  const labelEvent = findApprovalLabelEvent(
    await fetchApprovalEvents(octokit.rest.issues, owner, repo, number),
  );

  assertLabelPresent(labelEvent, prRef);

  return labelEvent.actor.login;
}

async function fetchApprovalEvents(
  issues: Octokit["rest"]["issues"],
  owner: string,
  repo: string,
  number: number,
): Promise<IssueEvents> {
  try {
    return await issues.listEvents({
      owner,
      repo,
      issue_number: number,
      per_page: 100,
    });
  } catch (err) {
    throw new TwoKeyError(
      `GitHub API error fetching events: ${(err as Error).message}`,
      "github_api",
    );
  }
}

// Octokit discriminated union: `label` exists only on `labeled`/`unlabeled` variants.
function findApprovalLabelEvent(events: IssueEvents): LabelEvent | undefined {
  return events.data.find((e) => {
    if (e.event !== "labeled") {
      return false;
    }
    const labeled = e as unknown as { label?: { name?: string } };

    return labeled.label?.name === APPROVAL_LABEL;
  });
}

function assertLabelPresent(
  labelEvent: LabelEvent | undefined,
  prRef: string,
): asserts labelEvent is LabelEvent & { actor: { login: string } } {
  enforceTrue(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- octokit types `actor` as required, but GitHub returns null for a deleted/anonymized account.
    !(!labelEvent || !labelEvent.actor?.login),
    (message) => new TwoKeyError(message, "label_missing"),
    `Approval label "${APPROVAL_LABEL}" missing on PR ${prRef}`,
  );
}

/** The person who applied the label must own the code. A CODEOWNERS file of only team handles is refused EXPLICITLY rather than treated as "no owners": team-membership lookup is not implemented, and silently failing closed would read as the approver being unauthorized when the real problem is this checker. */
async function enforceApproverIsCodeowner(check: {
  octokit: Octokit;
  owner: string;
  repo: string;
  targetRepo: string;
  approver: string;
}): Promise<void> {
  const { octokit, owner, repo, targetRepo, approver } = check;
  const codeowners = await fetchCodeowners({ octokit, owner, repo });

  if (isCodeowner(approver, codeowners)) {
    return;
  }

  throwApproverRejected({ codeowners, approver, targetRepo });
}

/** Fetch CODEOWNERS file (.github/, root, docs/); returns [pattern, owners[]] or empty array. */
async function fetchCodeowners(
  ref: RepoRef,
): Promise<Array<{ pattern: string; owners: string[] }>> {
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

function parseCodeowners(
  text: string,
): Array<{ pattern: string; owners: string[] }> {
  const out: Array<{ pattern: string; owners: string[] }> = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();

    if (!line) {
      continue;
    }
    const tokens = line.split(/\s+/);

    if (tokens.length < 2) {
      continue;
    }
    out.push({
      pattern: tokens[0],
      owners: tokens.slice(1),
    });
  }

  return out;
}

/** Check if login is a CODEOWNERS member anywhere (v1: whole-repo check, not per-path). */
export function isCodeowner(
  login: string,
  codeowners: Array<{ pattern: string; owners: string[] }>,
): boolean {
  const handle = login.startsWith("@") ? login : "@" + login;

  for (const row of codeowners) {
    if (row.owners.includes(handle)) {
      return true;
    }
  }

  return false;
}

/** Reached only when the approver did not match; the team-handle case is refused under its OWN code first, because reporting it as "not a codeowner" would blame the approver for a lookup this checker does not implement. */
function throwApproverRejected(rejection: {
  codeowners: Array<{ pattern: string; owners: string[] }>;
  approver: string;
  targetRepo: string;
}): never {
  const { codeowners, approver, targetRepo } = rejection;

  enforceTrue(
    !isTeamOnlyCodeowners(codeowners),
    (message) => new TwoKeyError(message, "team_membership_unresolved"),
    `${targetRepo}'s CODEOWNERS contains only team handles (e.g. @org/team); ` +
      `team-membership lookup is not implemented in v1. Add an explicit ` +
      `@user owner for the approver, or wait for the per-path team ` +
      `resolution follow-up.`,
  );
  throw new TwoKeyError(
    `${approver} is not a CODEOWNERS member of ${targetRepo}`,
    "approver_not_codeowner",
  );
}

// Team-membership lookup against GitHub team API is a follow-up; v1 requires direct @user handles in CODEOWNERS.
function isTeamOnlyCodeowners(
  codeowners: Array<{ pattern: string; owners: string[] }>,
): boolean {
  return (
    codeowners.length > 0 &&
    codeowners.every((row) => row.owners.every((o) => o.includes("/")))
  );
}
