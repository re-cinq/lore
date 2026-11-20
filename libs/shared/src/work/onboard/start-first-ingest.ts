// Starts a repository's first full ingestion once onboarding is done: the push run only sends the last commit's diff, and an up-to-date repository has no push at all. A workflow that cannot be started is a gap for a person to read, never an error that stops the other one.

import { errorMessage, type StepFailure } from "../../lib/error-classify.js";
import type { Settings } from "../../outbound/project/settings/settings.js";

export type FirstIngestWorkflows = Pick<
  Settings,
  "workflowState" | "enableWorkflow" | "dispatchWorkflow"
>;

export interface FirstIngest {
  /** The workflow files that were dispatched. */
  started: string[];
  /** Each workflow file that could not be started, with why. */
  gaps: StepFailure[];
}

const FIRST_INGEST_WORKFLOWS = ["lore-ingest.yml", "lore-tests.yml"];

export async function startFirstIngest(
  workflows: FirstIngestWorkflows,
  defaultBranch: string,
): Promise<FirstIngest> {
  const result: FirstIngest = { started: [], gaps: [] };

  for (const file of FIRST_INGEST_WORKFLOWS) {
    const gap = await tryStart(workflows, file, defaultBranch);

    if (gap) {
      result.gaps.push(gap);
      continue;
    }
    result.started.push(file);
  }

  return result;
}

async function tryStart(
  workflows: FirstIngestWorkflows,
  file: string,
  defaultBranch: string,
): Promise<StepFailure | null> {
  try {
    const state = await workflows.workflowState(file);

    if (state === "missing") {
      return { step: file, error: "the workflow is not on the default branch" };
    }

    if (state === "disabled") {
      await workflows.enableWorkflow(file);
    }
    await workflows.dispatchWorkflow(file, defaultBranch);

    return null;
  } catch (err) {
    return { step: file, error: errorMessage(err) };
  }
}
