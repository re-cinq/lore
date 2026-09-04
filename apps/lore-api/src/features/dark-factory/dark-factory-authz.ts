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

/** Verify the approval ceremony; returns evidence or throws TwoKeyError. Approval PR must match targetRepo (FR3.9). */
export async function verifyApproval(opts: {
  octokit: Octokit;
  prRef: string;
  targetRepo: string; // "owner/repo"
}): Promise<ApprovalEvidence> {
  const { octokit, prRef, targetRepo } = opts;
  const { owner, repo, number } = parsePrRef(prRef);

  if (`${owner}/${repo}` !== targetRepo) {
    throw new TwoKeyError(
      `Approval PR ${prRef} is against ${owner}/${repo}, not ${targetRepo}`,
      "wrong_repo",
    );
  }
  const pr = await fetchApprovalPr(octokit, owner, repo, number, prRef);

  if (pr.state !== "open") {
    throw new TwoKeyError(
      `Approval PR ${prRef} is ${pr.state}; ceremony requires open PR`,
      "pr_state",
    );
  }
  const approver = await findApprover(octokit, owner, repo, number, prRef);
  const codeowners = await fetchCodeowners({ octokit, owner, repo });

  if (!isCodeowner(approver, codeowners)) {
    refuseNonCodeowner(approver, targetRepo, codeowners);
  }

  return { prRef, approver, prUrl: pr.htmlUrl };
}

/** The approval PR itself. A 404 is a different refusal from an API failure: one means the ceremony was never performed, the other that we cannot tell. */
async function fetchApprovalPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  number: number,
  prRef: string,
): Promise<{ state: string; htmlUrl: string }> {
  try {
    const pr = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: number,
    });

    return { state: pr.data.state, htmlUrl: pr.data.html_url };
  } catch (err) {
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
}

/** Who applied the approval label — the second key. The label alone proves nothing; the actor who applied it is the evidence. */
async function findApprover(
  octokit: Octokit,
  owner: string,
  repo: string,
  number: number,
  prRef: string,
): Promise<string> {
  let events;

  try {
    events = await octokit.rest.issues.listEvents({
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
  // Octokit discriminated union: `label` exists only on `labeled`/`unlabeled` variants.
  const labelEvent = events.data.find((e) => {
    if (e.event !== "labeled") {
      return false;
    }
    const labeled = e as unknown as { label?: { name?: string } };

    return labeled.label?.name === APPROVAL_LABEL;
  });

  enforceTrue(
    !(!labelEvent || !labelEvent.actor?.login),
    (message) => new TwoKeyError(message, "label_missing"),
    `Approval label "${APPROVAL_LABEL}" missing on PR ${prRef}`,
  );

  return labelEvent.actor.login;
}

/** Two ways to fail the codeowner check, and they mean different things to whoever is stuck: the approver genuinely is not an owner, or CODEOWNERS names only teams and v1 cannot resolve membership. */
function refuseNonCodeowner(
  approver: string,
  targetRepo: string,
  codeowners: Array<{ pattern: string; owners: string[] }>,
): never {
  // Team-membership lookup against GitHub team API is a follow-up; v1 requires direct @user handles in CODEOWNERS.
  enforceTrue(
    !(
      codeowners.length > 0 &&
      codeowners.every((row) => row.owners.every((o) => o.includes("/")))
    ),
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

/** Fetch CODEOWNERS file (.github/, root, docs/); returns [pattern, owners[]] or empty array. */
async function fetchCodeowners(opts: {
  octokit: Octokit;
  owner: string;
  repo: string;
}): Promise<Array<{ pattern: string; owners: string[] }>> {
  const candidates = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

  for (const filepath of candidates) {
    try {
      const r = await opts.octokit.rest.repos.getContent({
        owner: opts.owner,
        repo: opts.repo,
        path: filepath,
      });
      const pull = r.data;

      if ("content" in pull && pull.encoding === "base64") {
        const text = Buffer.from(pull.content, "base64").toString("utf-8");

        return parseCodeowners(text);
      }
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        continue;
      }
      throw new TwoKeyError(
        `CODEOWNERS unparseable: ${(err as Error).message}`,
        "codeowners_unparseable",
      );
    }
  }

  return [];
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
