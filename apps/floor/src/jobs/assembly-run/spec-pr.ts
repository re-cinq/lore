/**
 * Open + record the PR a `push` node produced.
 *
 * Nothing did this for an assembly line. The push recipe ends "commit it, and
 * stop … The watcher opens the PR" (`scripts/task-types.yaml`), and the watcher
 * returns early for every CR carrying `lore.re-cinq.com/assembly-line-id`
 * (`agent-watcher.ts`) precisely so per-CR dedupe cannot route each node of a line
 * into PR creation. The single-agent path kept the PR logic; the line path got
 * none, so on the merged planning line no spec PR was ever opened and
 * `lore.features.spec_pr_url` stayed null.
 *
 * Recording it on the LINE is the load-bearing half. `findOpenByPr` matches on
 * `args->>'pr_number'`, so a line whose PR was never stamped cannot be found when
 * that PR merges — which is what the `merged` wait node needs to be resumable.
 *
 * The decision is pure and separate from the effect: whether a finished node earns
 * a PR is a rule, and rules are worth testing without a GitHub double.
 */

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type {
  Feature,
  FeaturePatch,
  FeatureStatus,
} from "@re-cinq/lore-shared/project/features/features-port.js";

/** The `prompt_ref` every line's pushing node carries (implementation, general,
 *  gap-fill, feature-planning). Identifying the node by its
 *  recipe rather than its id keeps this working for a line that names it
 *  something other than "push". */
const PUSH_PROMPT_REF = "push-only";

/**
 * What a failed PR open MEANS for the line.
 *
 * `empty-branch` — GitHub refused because the branch carries nothing to review.
 * The pushing node reported success and pushed nothing (#1330), so no retry can
 * help and the wait node downstream would park forever on a PR that cannot
 * exist. That is a failed line, and saying so is the whole point: the wizard
 * reads a diagnosis instead of showing "Waiting for the spec PR" indefinitely.
 *
 * `transient` — anything else (a 5xx, a token blip). The line keeps its shape
 * and the reaper re-drives it; failing a run on a network hiccup would throw
 * away work that is genuinely fine.
 *
 * Matched on GitHub's own validation text rather than a status code: a 422 is
 * also what a duplicate PR or a bad base returns, and only this one means the
 * branch is empty.
 */
export function decideStampFailure(
  message: string,
): "empty-branch" | "transient" {
  return /no commits between/i.test(message) ? "empty-branch" : "transient";
}

/** The reason recorded on a line whose branch had nothing to open a PR from —
 *  written for whoever reads it in the wizard, naming the node that should have
 *  delivered and the branch that stayed empty. */
export function emptyBranchReason(branch: string | null): string {
  return `the push node reported success but pushed nothing — ${branch ?? "the run branch"} has no commits, so no spec PR could be opened`;
}

/** Whether the node that just finished should cause the line's PR to be ensured.
 *  Pure. A line that already carries a `pr_number` is skipped, so a push re-run
 *  after a write/analyse correction updates the existing PR rather than opening a
 *  second one for the same branch. */
export function decidePrStamp(input: {
  promptRef?: string | null;
  outcome: string | null;
  args: Record<string, unknown>;
}): boolean {
  return (
    input.promptRef === PUSH_PROMPT_REF &&
    input.outcome === "success" &&
    !input.args.pr_number
  );
}

/** The surface this writes through — a narrow, repo-bound slice of `project`, so a
 *  caller passes `project.pulls` and `project.features` straight in. */
export interface SpecPrPorts {
  pulls: {
    list(): Promise<PullRef[]>;
    open(branch: string, title: string, body: string): Promise<PullRef>;
  };
  assemblyRuns: {
    mergeArgs(id: string, patch: Record<string, unknown>): Promise<void>;
  };
  features: {
    get(id: string): Promise<Feature | null>;
    /** Returns the updated row; this module ignores it, so the narrowest honest
     *  contract is "resolves to something". */
    transitionStatus(
      id: string,
      status: FeatureStatus,
      patch?: FeaturePatch,
    ): Promise<unknown>;
  };
}

/** The open PR already on this branch, if any — pushing twice must not fork the
 *  review across two PRs. */
async function existingPrFor(
  branch: string,
  pulls: SpecPrPorts["pulls"],
): Promise<PullRef | null> {
  const open = await pulls.list();

  return open.find((pr) => pr.branch === branch) ?? null;
}

/** Ensure the line's branch has a PR, record it on the line, and — when the line
 *  carries a feature — move that feature to `pr-open` with the spec PR on it.
 *
 *  The stamp happens BEFORE the feature transition and is not undone if that
 *  transition throws: losing the stamp would strand the line at its `merged` node
 *  forever, which is a worse failure than a stale feature status a later run can
 *  still correct. */
export async function stampLinePr(
  row: AssemblyRunRecord,
  ports: SpecPrPorts,
): Promise<void> {
  const branch = row.branch;

  if (!branch) {
    return;
  }
  const featureId =
    typeof row.args.feature_id === "string" ? row.args.feature_id : null;
  const feature = featureId ? await ports.features.get(featureId) : null;
  const title = feature ? `spec: ${feature.title}` : `lore: ${branch}`;
  const pr =
    (await existingPrFor(branch, ports.pulls)) ??
    (await ports.pulls.open(branch, title, prBody(branch, feature)));

  await ports.assemblyRuns.mergeArgs(row.id, {
    pr_number: pr.number,
    pr_url: pr.url,
  });

  if (!feature) {
    return;
  }

  try {
    await ports.features.transitionStatus(feature.id, "pr-open", {
      spec_pr_url: pr.url,
      spec_pr_number: pr.number,
      spec_path: `specs/${feature.slug}/spec.md`,
    });
  } catch (err) {
    console.warn(
      `[spec-pr] feature ${feature.id} not moved to pr-open: ${(err as Error).message}`,
    );
  }
}

function prBody(branch: string, feature: Feature | null): string {
  if (!feature) {
    return `Opened by the Lore assembly line from \`${branch}\`.`;
  }

  return [
    `## ${feature.title}`,
    "",
    feature.original_prompt,
    "",
    `Planned interactively; this PR carries the agreed spec from \`${branch}\`.`,
  ].join("\n");
}
