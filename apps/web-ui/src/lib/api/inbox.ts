import "server-only";
import type { AssemblyRun } from "../assembly-run-rows";
import { getFloorRuns } from "./floor-runs";

// The inbox: the floor's runs a person has to look at, failed or parked, composed from the run list's own reads.

export type InboxKind = "failed" | "waiting";

export interface InboxItem {
  kind: InboxKind;
  runId: string;
  repo: string;
  title: string;
  body: string;
  /** When the run began: how long the item has been waiting. */
  since: string;
  /** Where the run's work lives on GitHub, when it has a page there. */
  link: { label: string; href: string } | null;
}

/** How far back a failure still asks for a person; an older one is history. */
export const FAILURE_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

/** Everything waiting on a person across every repository: one page of the floor's failed runs and one of its running runs. */
export async function getInboxItems(
  nowMs: number = Date.now(),
): Promise<InboxItem[]> {
  const [failed, running] = await Promise.all([
    getFloorRuns({ status: "failed" }),
    getFloorRuns({ status: "running" }),
  ]);

  return inboxItemsOf(failed.runs, running.runs, nowMs);
}

/** Failures first, newest first; then parked runs, the longest-waiting first. */
export function inboxItemsOf(
  failed: readonly AssemblyRun[],
  running: readonly AssemblyRun[],
  nowMs: number,
): InboxItem[] {
  const cutoff = nowMs - FAILURE_WINDOW_DAYS * DAY_MS;
  const failures = failed
    .filter((run) => Date.parse(sinceOf(run)) >= cutoff)
    .map(failedItem);
  const waiting = running.filter(isParked).map(waitingItem);

  return [...byNewest(failures), ...byNewest(waiting).reverse()];
}

function byNewest(entries: InboxItem[]): InboxItem[] {
  return [...entries].sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
}

function sinceOf(run: AssemblyRun): string {
  return run.startedAt ?? run.createdAt;
}

function isParked(run: AssemblyRun): boolean {
  return parkedStations(run).length > 0;
}

function parkedStations(run: AssemblyRun): string[] {
  return (run.pipeline ?? [])
    .filter((node) => node.state === "waiting")
    .map((node) => node.node_id);
}

function failedItem(run: AssemblyRun): InboxItem {
  return {
    ...itemBase(run),
    kind: "failed",
    title: `${run.blueprintName} failed`,
    body: run.reason ?? "The run stopped before it finished.",
  };
}

function waitingItem(run: AssemblyRun): InboxItem {
  const stations = parkedStations(run).join(", ");

  return {
    ...itemBase(run),
    kind: "waiting",
    title: `${run.blueprintName} is waiting at ${stations}`,
    body:
      run.specPlanSummary ??
      `Parked at ${stations}: a review or a build owns the next move.`,
  };
}

function itemBase(run: AssemblyRun) {
  return {
    runId: run.id,
    repo: run.repo,
    since: sinceOf(run),
    link: githubLink(run),
  };
}

/** The pull request when the run has one, else its issue. */
function githubLink(run: AssemblyRun): InboxItem["link"] {
  if (run.prUrl) {
    return { label: "Open pull request", href: run.prUrl };
  }

  return run.issueUrl ? { label: "Open issue", href: run.issueUrl } : null;
}
