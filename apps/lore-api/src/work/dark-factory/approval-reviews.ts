import type { Octokit } from "octokit";

const PAGE_SIZE = 100;
const DECISIVE_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

type PullReviews = Awaited<ReturnType<Octokit["rest"]["pulls"]["listReviews"]>>;
type PullReview = PullReviews["data"][number];

export interface ReviewLookup {
  octokit: Octokit;
  owner: string;
  repo: string;
  number: number;
}

export async function standingApprovers(
  target: ReviewLookup,
): Promise<string[]> {
  const latest = new Map<string, { login: string; approved: boolean }>();

  for (const review of await listAllReviews(target)) {
    const decision = decisionOf(review);

    if (decision) {
      latest.set(decision.login.toLowerCase(), decision);
    }
  }

  return [...latest.values()].filter((d) => d.approved).map((d) => d.login);
}

function decisionOf(
  review: PullReview,
): { login: string; approved: boolean } | undefined {
  const login = (review.user as { login?: string } | null)?.login;
  const state = review.state.toUpperCase();

  return login && DECISIVE_STATES.has(state)
    ? { login, approved: state === "APPROVED" }
    : undefined;
}

async function listAllReviews(target: ReviewLookup): Promise<PullReview[]> {
  const { pulls } = target.octokit.rest;
  const reviews: PullReview[] = [];

  for (let page = 1; ; page++) {
    const res = await pulls.listReviews({
      owner: target.owner,
      repo: target.repo,
      pull_number: target.number,
      per_page: PAGE_SIZE,
      page,
    });

    reviews.push(...res.data);

    if (res.data.length < PAGE_SIZE) {
      return reviews;
    }
  }
}
