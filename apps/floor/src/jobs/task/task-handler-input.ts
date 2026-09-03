import type { PipelineTask } from "@re-cinq/lore-shared";

/** What the worker hands every task handler: the claimed task, where it runs, and the branch and Issue already minted for it. */
export interface TaskHandlerInput {
  task: PipelineTask;
  targetRepo: string;
  branchName: string;
  model: string | undefined;
  issueNumber: number | null;
}
