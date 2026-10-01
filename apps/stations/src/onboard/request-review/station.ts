// Asks the code-review line for a review of the onboarding pull request. Asked for by name because that line starts on its own only for pull requests a person opened.

import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { parsePullRequestUrl } from "@re-cinq/lore-shared/floor/floor-items.js";
import { errorMessage } from "@re-cinq/lore-shared/lib/error-classify.js";
import {
  startReview,
  type StartReviewInput,
} from "@re-cinq/lore-shared/review/floor-review-start.js";
import { projectFor } from "../../outbound/project-boot.js";

export interface RequestReviewDeps {
  startReview(input: StartReviewInput): Promise<string | null>;
}

const productionDeps: RequestReviewDeps = {
  startReview: async (input) => {
    const { pulls, issues } = await projectFor(input.repo);

    return startReview(
      { floor: floorClient(), pulls, issues, uiUrl: process.env.LORE_UI_URL },
      input,
    );
  },
};

export function requestReviewHandle(deps: RequestReviewDeps): Handle {
  return async ({ needs }) => {
    try {
      await deps.startReview({
        ...parsePullRequestUrl(needs.pr_url),
        autoReview: true,
        forced: true,
      });

      return { outcome: "success" };
    } catch (err) {
      return { outcome: "failed", error: errorMessage(err) };
    }
  };
}

export function startRequestReviewStation(): RunningStation {
  return defineStation(
    "onboard-request-review",
    requestReviewHandle(productionDeps),
  );
}
