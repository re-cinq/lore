import { resultTextFromOutput } from "@re-cinq/lore-assembly-lines";
import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { getPool } from "@re-cinq/lore-shared/db/pg-pool.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import {
  floorRepoOf,
  parsePullRequestUrl,
  type PullRequestLocation,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { loreAppLogin } from "@re-cinq/lore-shared/project/github-installations/lore-app-login.js";
import {
  publishReviewProgress,
  type ReviewProgressProject,
  type ReviewProgress,
} from "@re-cinq/lore-shared/review/review-progress.js";
import { projectFor } from "../../outbound/project-boot.js";
import { withProgressLock } from "./progress-lock.js";
import {
  formalReview,
  reviewPasses,
  storyPasses,
  storyReview,
  type PassName,
  type PassOutputs,
  type ReviewState,
} from "@re-cinq/lore-shared/review/story/story.js";

// Where each node stands in the review, which orders the comment's updates, and the passes that must have answered when it publishes; publish-incomplete shows whatever did.
const stages: Record<string, { stage: number; passes: readonly PassName[] }> = {
  "publish-story": { stage: 1, passes: ["story"] },
  "publish-checks": { stage: 3, passes: storyPasses },
  finalize: { stage: 4, passes: storyPasses },
  "publish-incomplete": { stage: 4, passes: storyPasses },
};

const SUCCESS: Report = { outcome: "success" };

type ProgressVisit = {
  nodeId: string;
  runId: string;
  lineId: string;
  repo: string | null;
  startedAt: number;
};

interface ProgressDeps {
  appLogin(): Promise<string | undefined>;
  visit(visitId: string): Promise<ProgressVisit | undefined>;
  project(repo: string): Promise<ReviewProgressProject>;
  serialize(
    repo: string,
    prNumber: number,
    publish: () => Promise<void>,
  ): Promise<void>;
}

export function startReviewProgressStation(
  name:
    "code-review-progress" | "code-review-docs-gate" | "finalize-code-review",
): RunningStation {
  return defineStation(name, reviewProgressHandle(productionDeps));
}

export function reviewProgressHandle(deps: ProgressDeps): Handle {
  return async (brief, tools) => {
    const [visit, outputs] = await Promise.all([
      readReviewVisit(deps, brief.visitId),
      readOutputs(brief.needs, tools),
    ]);

    const publication = publicationOf(visit, outputs, brief.needs);
    const { state, progress } = publication;

    if (state !== "failed" && progress.incomplete.length > 0) {
      return failedEvidence(progress.incomplete);
    }

    if (state === "complete") {
      await produceFormalReview(outputs, publication.required, tools);
    }

    await publishProgress(deps, brief.needs, publication, tools.signal);

    return progressReport(visit, state, brief.needs);
  };
}

function publicationOf(
  visit: ProgressVisit,
  outputs: PassOutputs,
  needs: Record<string, string>,
): Publication {
  const { stage, passes } = stageOf(visit.nodeId);
  const required = requiredPasses(passes, needs);

  return {
    visit,
    stage,
    required,
    state: progressState(visit.nodeId),
    progress: storyReview(outputs, required),
  };
}

/** The passes a node waits for: a pull request of documents alone has only the documents check, one that changes only links has none, and the documents check joins the story's passes once it has run. */
function requiredPasses(
  passes: readonly PassName[],
  { review_mode: mode, docs_check: documents }: Record<string, string>,
): readonly PassName[] {
  if (mode === "links") {
    return [];
  }

  if (mode === "docs") {
    return ["docs_check"];
  }

  return documents ? [...passes, "docs_check"] : passes;
}

async function produceFormalReview(
  outputs: PassOutputs,
  required: readonly PassName[],
  tools: Tools,
): Promise<void> {
  const review = formalReview(outputs, required);

  enforceTrue(
    review,
    Error,
    "A formal verdict requires every pass of the review",
  );
  const json = JSON.stringify(review).replaceAll("`", "\\u0060");

  await tools.produce(
    "review_output",
    ["```REVIEW_FINDINGS", json, "```"].join("\n"),
  );
}

type Publication = {
  visit: ProgressVisit;
  stage: number;
  required: readonly PassName[];
  state: ReviewState;
  progress: ReturnType<typeof storyReview>;
};

async function publishProgress(
  deps: ProgressDeps,
  { pr_url: url, revision, preparation_failed }: Record<string, string>,
  { visit, stage, state, progress }: Publication,
  signal: AbortSignal,
): Promise<void> {
  if (url) {
    const target = hostedTarget(url, revision, visit);
    const body =
      progress.comment(revision, state) +
      preparationNote(state, preparation_failed);

    await publishHosted(
      deps,
      target,
      { ...identityOf(visit), stage, body, headSha: revision },
      signal,
    );
  }
}

// Posting retries share the run marker so GitHub receives the verdict only once. After both checks, a pull request that changes documents goes to the documents check.
function progressReport(
  visit: ProgressVisit,
  state: ReviewState,
  needs: Record<string, string>,
): Report {
  if (state === "complete") {
    return { outcome: "success", produced: { review_run: visit.runId } };
  }

  return visit.nodeId === "publish-checks" && needs.docs_changed === "true"
    ? { outcome: "docs" }
    : SUCCESS;
}

function preparationNote(state: ReviewState, failed: string): string {
  return state === "failed" && failed === "true"
    ? "\n\nLore could not prepare the evidence for this revision."
    : "";
}

function identityOf({ runId, startedAt }: ProgressVisit) {
  return { runId, startedAt };
}

function failedEvidence(passes: string[]): Report {
  return {
    outcome: "failed",
    error: `Incomplete review evidence: ${passes.join(", ")}`,
  };
}

async function readReviewVisit(
  deps: ProgressDeps,
  visitId: string,
): Promise<ProgressVisit> {
  const visit = await deps.visit(visitId);

  enforceTrue(
    visit &&
      ["code-review", "code-review-recheck"].includes(visit.lineId) &&
      Number.isFinite(visit.startedAt),
    Error,
    "Review progress requires a code review visit",
  );

  return visit;
}

function stageOf(nodeId: string): (typeof stages)[string] {
  enforceTrue(nodeId in stages, Error, `Unknown review stage ${nodeId}`);

  return stages[nodeId];
}

function hostedTarget(
  url: string,
  revision: string,
  visit: ProgressVisit,
): PullRequestLocation {
  const target = parsePullRequestUrl(url);

  enforceTrue(
    /^[a-f0-9]{40}$/.test(revision),
    Error,
    "Review progress requires a full commit SHA",
  );
  enforceTrue(
    visit.repo === floorRepoOf(target.repo),
    Error,
    "Review visit must belong to the pull request repository",
  );

  return target;
}

async function publishHosted(
  deps: ProgressDeps,
  { repo, prNumber }: PullRequestLocation,
  progress: Omit<ReviewProgress, "appLogin" | "prNumber">,
  signal: AbortSignal,
): Promise<void> {
  const [project, appLogin] = await Promise.all([
    deps.project(repo),
    deps.appLogin(),
  ]);

  enforceTrue(appLogin, Error, "Review publication requires Lore's GitHub App");

  await deps.serialize(repo, prNumber, () =>
    publishReviewProgress(project, { ...progress, prNumber, appLogin }, signal),
  );
}

function progressState(nodeId: string): ReviewState {
  switch (nodeId) {
    case "finalize":
      return "complete";
    case "publish-incomplete":
      return "failed";
    default:
      return "running";
  }
}

async function readOutputs(
  needs: Record<string, string>,
  tools: Tools,
): Promise<PassOutputs> {
  const outputs = await Promise.all(
    reviewPasses
      .filter((name) => needs[name])
      .map(
        async (name) =>
          [
            name,
            resultTextFromOutput((await tools.read(name)).toString("utf8")),
          ] as const,
      ),
  );

  return Object.fromEntries(outputs);
}

const productionDeps: ProgressDeps = {
  appLogin: loreAppLogin,
  visit: progressVisit,
  project: projectFor,
  serialize: (repo, prNumber, publish) =>
    withProgressLock(
      getPool(),
      `code-review:${repo.toLowerCase()}#${prNumber}`,
      publish,
    ),
};

async function progressVisit(
  visitId: string,
): Promise<ProgressVisit | undefined> {
  const floor = floorClient();
  const visit = await floor.stationRuns.get(visitId);
  const run = visit && (await floor.runs.get(visit.runId))?.run;

  if (visit && run) {
    return {
      nodeId: visit.nodeId,
      runId: run.id,
      lineId: run.lineId,
      repo: run.repo,
      startedAt: Date.parse(run.createdAt),
    };
  }
}
