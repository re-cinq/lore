import type { Octokit } from "octokit";
import type { BranchRule, Mergeability } from "../pulls/pull-requests-port.js";
import { split } from "./platform-github-support.js";

interface RulesetRule {
  type: string;
  parameters?: {
    required_approving_review_count?: number;
    require_code_owner_review?: boolean;
    required_status_checks?: Array<{ context: string }>;
  };
}

interface ClassicProtection {
  required_pull_request_reviews?: {
    required_approving_review_count?: number;
    require_code_owner_reviews?: boolean;
  };
  required_status_checks?: {
    contexts?: string[];
    checks?: Array<{ context: string }>;
  };
}

/** The branch rule from the rulesets that apply to the branch and its classic protection; a branch with no classic protection answers 404, read as none. */
export async function getBranchRule(
  ok: Octokit,
  repo: string,
  branch: string,
): Promise<BranchRule> {
  const [owner, name] = split(repo);
  const where = { owner, repo: name, branch };
  const [rules, classic] = await Promise.all([
    ok.request("GET /repos/{owner}/{repo}/rules/branches/{branch}", where),
    classicProtection(ok, where),
  ]);

  return branchRuleOf(rules.data as RulesetRule[], classic);
}

async function classicProtection(
  ok: Octokit,
  where: { owner: string; repo: string; branch: string },
): Promise<ClassicProtection> {
  try {
    const { data: protection } = await ok.request(
      "GET /repos/{owner}/{repo}/branches/{branch}/protection",
      where,
    );

    return protection as ClassicProtection;
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return {};
    }
    throw err;
  }
}

function branchRuleOf(
  rules: RulesetRule[],
  classic: ClassicProtection,
): BranchRule {
  const demands = [
    ...rules.map((rule) => rulesetDemand(rule.parameters ?? {})),
    classicDemand(classic),
  ];

  return {
    requiredApprovals: Math.max(0, ...demands.map((d) => d.requiredApprovals)),
    codeOwnersReview: demands.some((d) => d.codeOwnersReview),
    requiredChecks: [
      ...new Set(demands.flatMap((d) => d.requiredChecks)),
    ].sort(),
  };
}

function rulesetDemand(
  parameters: NonNullable<RulesetRule["parameters"]>,
): BranchRule {
  return {
    requiredApprovals: parameters.required_approving_review_count ?? 0,
    codeOwnersReview: parameters.require_code_owner_review === true,
    requiredChecks: (parameters.required_status_checks ?? []).map(
      (check) => check.context,
    ),
  };
}

function classicDemand(classic: ClassicProtection): BranchRule {
  const reviews = classic.required_pull_request_reviews ?? {};
  const checks = classic.required_status_checks ?? {};

  return {
    requiredApprovals: reviews.required_approving_review_count ?? 0,
    codeOwnersReview: reviews.require_code_owner_reviews === true,
    requiredChecks: [
      ...(checks.contexts ?? []),
      ...(checks.checks ?? []).map((check) => check.context),
    ],
  };
}

export async function getMergeability(
  ok: Octokit,
  repo: string,
  number: number,
): Promise<Mergeability> {
  const [owner, name] = split(repo);
  const { pulls } = ok.rest;
  const { data: pr } = await pulls.get({
    owner,
    repo: name,
    pull_number: number,
  });

  return { mergeable: pr.mergeable, state: pr.mergeable_state };
}
