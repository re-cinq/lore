/** The event-driven walk's injected dependency contract. */

import type {
  AssemblyRunsPort,
  AssemblyRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { AssemblyLine, NodeResult } from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { ResolveConversationFn } from "./launch-spec.js";

export interface AdvanceDeps {
  assemblyRuns: AssemblyRunsPort;
  /** Fallback only: a run stamped since FR6.38 carries its own graph; this covers rows that predate the clone. Delete once no open run lacks a graph. */
  definitions: () => Promise<ReadonlyMap<string, AssemblyLine>>;
  /** Raw `lore.repos.settings`, source of `station_default_tags` for `resolveRequiredTags` (FR2); null repo row means "no default". */
  repoSettings: (repo: string) => Promise<Record<string, unknown> | null>;
  /** Catalog base name, project-qualified when the repo overrides it (bare-name collision let repos replace each other's recipe); optional seam, absent means bare/org-default. */
  qualifyStationRef?: (baseRef: string, repo: string) => Promise<string>;
  resolvePrompt: (promptRef: string, description: string) => string;
  /** Post-close hook for the implementation loop's driver; winning finisher only, best-effort, optional seam like notifyFailure. */
  onRunClosed?(
    run: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ): Promise<void>;
  /** Reclaim the run's per-task token once the line is terminal. */
  cleanupToken: (runTaskId: string) => Promise<void>;
  /** React to a node FINISHING (CR event, reaper resolve, or `assembly_run.resume`), passed RESOLVED so a reaction can read its TYPE rather than compare hardcoded ids. Injected so this module keeps importing only its own folder. */
  onNodeFinished?: (
    row: AssemblyRunRecord,
    node: RunGraphNode,
    result: NodeResult,
  ) => Promise<void>;
  /** Publish a `runtime: "service"` node for the pooled service to claim instead of a pod; it reports back over `assembly_run.resume`. Optional seam — a composition without it never dispatches a service node, and the reaper times it out. */
  publishNode?: (event: {
    eventName: string;
    params: Record<string, unknown>;
    dedupeKey?: string;
  }) => Promise<void>;
  /** Writes the run's episode here (the `retrospective` station's job, which never runs — every blueprint names it as EXIT and the walk finishes AT exit without dispatching it). Optional seam, like notifyFailure. */
  recordRunEpisode?: (
    run: AssemblyRunRecord,
    outcome: string,
    reason: string | undefined,
  ) => Promise<void>;
  /** Detection-line bookkeeping: close the `args.job_run_id` pipeline.job_runs row the fan-out pre-created, with the line's terminal state. */
  jobRuns: {
    complete(runId: string, resultSummary: string): Promise<unknown>;
    fail(runId: string, reason: string): Promise<unknown>;
  };
  /** User-facing failure notification (Slack + PR comment), fired once per line by the winning finisher; optional seam. */
  notifyFailure?: (
    assemblyRun: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /** Resolve a node's `continues` declaration to the conversation this run should continue/save as; optional seam, absent means never continues (pre-feature behaviour). */
  resolveConversation?: ResolveConversationFn;
  /** Close the line's backing pipeline task (and, for a planning round, its feature iteration) so a failed line stops reading "still running" downstream; optional seam, same as notifyFailure. */
  settleTask?: (
    assemblyRun: AssemblyRunRecord,
    outcome: string,
    reason?: string,
  ) => Promise<void>;
  /** Account-wide LLM outage stop button, consulted BEFORE a station-run row is minted so a blocked node parks with no row/CR and the reaper re-drives later; optional seam. */
  llmGate?: {
    isBlocked(): boolean;
    trip(failureClass: string, detail?: string): boolean;
  };
  /** Ensure the `push` node's PR exists and is recorded on the line (`args.pr_number`), moving it to `pr-open` — nothing else does, since the push recipe's watcher ignores assembly-line CRs. Optional seam. */
  stampPr?: (assemblyRun: AssemblyRunRecord) => Promise<void>;
  /** Update the run's PR from its description artifact and take it out of draft (Floor-side — the pod has no `gh`/GitHub token); the finishing node's result carries the `Lore-Issue-Coverage` verdict deciding Closes-vs-Refs. */
  markPrReady?: (
    assemblyRun: AssemblyRunRecord,
    result: NodeResult,
  ) => Promise<void>;
}
