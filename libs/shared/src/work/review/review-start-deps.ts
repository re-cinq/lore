// What starting a review needs, bound to one repository's project: built the same way by every door a review comes through (a pull request's events, the onboarding's request, lore-api's route).
import { floorClient } from "../../outbound/floor/floor-client.js";
import { loreAppLogin } from "../../outbound/project/github-installations/lore-app-login.js";
import type {
  ReviewIssues,
  ReviewPulls,
  ReviewStartDeps,
} from "./floor-review-start.js";
import type { CarryChecks } from "./carry-approval.js";

export interface ReviewProject {
  pulls: ReviewPulls;
  issues: ReviewIssues;
  repo: CarryChecks;
}

export async function reviewStartDeps(
  project: ReviewProject,
): Promise<ReviewStartDeps> {
  return {
    floor: floorClient(),
    pulls: project.pulls,
    issues: project.issues,
    checks: project.repo,
    uiUrl: process.env.LORE_UI_URL,
    loreAppLogin: await loreAppLogin(),
  };
}
