import { Octokit } from "octokit";

/**
 * Two-key authorization for privileged dark-factory settings changes
 * (FR3.9, R9). The caller has already passed bearer-token + admin-scope
 * validation; this layer adds the CODEOWNERS-approval PR check.
 *
 * Ceremony: an open PR labeled `dark-factory-approval` whose label was
 * applied by a CODEOWNERS member of the affected repo's `CLAUDE.md`.
 * The PR itself is the audit ceremony; once the settings PUT succeeds
 * the PR can be merged or closed separately as a record.
 */

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
      | "codeowners_unparseable"
      | "github_api"
      | "wrong_repo",
  ) {
    super(message);
    this.name = "TwoKeyError";
  }
}

const PR_REF_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

export function parsePrRef(
  ref: string,
): { owner: string; repo: string; number: number } {
  const m = ref.match(PR_REF_RE);
  if (!m) {
    throw new TwoKeyError(
      `Invalid PR reference "${ref}" — expected owner/repo#N`,
      "invalid_pr_ref",
    );
  }
  return { owner: m[1], repo: m[2], number: Number.parseInt(m[3], 10) };
}

/**
 * Verify the approval ceremony. Returns the recorded evidence on
 * success; throws TwoKeyError otherwise.
 *
 * `targetRepo` is the repo whose dark-factory settings are being
 * mutated; the approval PR must be against the same repo (or a
 * centrally-managed `lore-settings` repo where rules apply by path).
 * For v1 we require the same repo.
 */
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

  let pr;
  try {
    pr = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: number,
    });
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      throw new TwoKeyError(`Approval PR ${prRef} not found`, "pr_not_found");
    }
    throw new TwoKeyError(
      `GitHub API error fetching ${prRef}: ${(err as Error).message}`,
      "github_api",
    );
  }

  if (pr.data.state !== "open") {
    throw new TwoKeyError(
      `Approval PR ${prRef} is ${pr.data.state}; ceremony requires open PR`,
      "pr_state",
    );
  }

  // Find the label-application event by the CODEOWNERS member.
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

  // Octokit types `events.data` as a discriminated union; `label` only
  // exists on `labeled`/`unlabeled` variants. Narrow + cast.
  const labelEvent = events.data.find((e) => {
    if (e.event !== "labeled") return false;
    const labeled = e as unknown as { label?: { name?: string } };
    return labeled.label?.name === APPROVAL_LABEL;
  });
  if (!labelEvent || !labelEvent.actor?.login) {
    throw new TwoKeyError(
      `Approval label "${APPROVAL_LABEL}" missing on PR ${prRef}`,
      "label_missing",
    );
  }

  const approver = labelEvent.actor.login;

  const codeowners = await fetchCodeowners({ octokit, owner, repo });
  if (!isCodeowner(approver, codeowners)) {
    throw new TwoKeyError(
      `${approver} is not a CODEOWNERS member of ${targetRepo}`,
      "approver_not_codeowner",
    );
  }

  return {
    prRef,
    approver,
    prUrl: pr.data.html_url,
  };
}

/**
 * Fetch CODEOWNERS file content (tries .github/, root, docs/ in that
 * order, GitHub's canonical lookup order). Returns the parsed line
 * tuples — each tuple is [pattern, owners[]]. Empty array on missing.
 */
async function fetchCodeowners(opts: {
  octokit: Octokit;
  owner: string;
  repo: string;
}): Promise<Array<{ pattern: string; owners: string[] }>> {
  const candidates = [
    ".github/CODEOWNERS",
    "CODEOWNERS",
    "docs/CODEOWNERS",
  ];
  for (const filepath of candidates) {
    try {
      const r = await opts.octokit.rest.repos.getContent({
        owner: opts.owner,
        repo: opts.repo,
        path: filepath,
      });
      const data = r.data;
      if ("content" in data && data.encoding === "base64") {
        const text = Buffer.from(data.content, "base64").toString("utf-8");
        return parseCodeowners(text);
      }
    } catch (err) {
      if ((err as { status?: number }).status === 404) continue;
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
    if (!line) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;
    out.push({
      pattern: tokens[0],
      owners: tokens.slice(1),
    });
  }
  return out;
}

/**
 * Check whether `login` is a CODEOWNERS member, anywhere in the file.
 * For v1 we only check membership at all (the approver of a settings
 * change must be *some* CODEOWNER of the repo — not necessarily of a
 * specific path). Tightening to per-path CODEOWNERS is a follow-up.
 */
export function isCodeowner(
  login: string,
  codeowners: Array<{ pattern: string; owners: string[] }>,
): boolean {
  const handle = login.startsWith("@") ? login : "@" + login;
  for (const row of codeowners) {
    if (row.owners.includes(handle)) return true;
  }
  return false;
}
