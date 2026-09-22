// Per-entry catalog apply: one entry's verdict, and tallying a batch of verdicts.

import { errorMessage } from "@re-cinq/lore-shared";
import {
  agentDefToCrds,
  catalogCrdName,
  validateCatalogEntry,
  type CatalogCrdOptions,
  type CrdPair,
} from "@re-cinq/lore-shared/project/agents/agent-crd.js";
import { isPermanentApplyError } from "../../lib/k8s-errors.js";
import type { CatalogApplyReport } from "@re-cinq/lore-shared/project/agents/catalog-status-port.js";
import type { ClusterAgentIdentity } from "../../domain/identity.js";
import type { CatalogEventsResponse } from "./catalog-sync-loop.js";

/** The two catalog operations a sync needs. The loop is the catalog's only writer, so it never asks who owns a live CR. */
export interface CatalogTarget {
  applyPair(pair: CrdPair): Promise<void>;
  deletePair(name: string): Promise<void>;
}

export interface CatalogSyncTickDeps {
  apiUrl: string;
  identity: () => ClusterAgentIdentity;
  catalog: CatalogTarget;
  crdOptions: CatalogCrdOptions;
  fetchFn?: typeof fetch;
}

/** What one entry did. `transient` is the only verdict that stops the batch: the ack stays put so the whole batch re-serves. */
type EntryVerdict =
  | { state: "applied" | "deleted" }
  | { state: "refused"; detail: string; reason: string }
  | { state: "transient"; message: string };

export interface BatchTally {
  applied: number;
  deleted: number;
  refused: string[];
  // Structured verdicts for the status report — a log line dies with the pod (2026-09-01).
  reports: CatalogApplyReport[];
}

export type BatchApplyResult =
  { kind: "ok"; tally: BatchTally } | { kind: "transient"; message: string };

export async function applyBatchEntries(
  deps: CatalogSyncTickDeps,
  entries: CatalogEventsResponse["entries"],
): Promise<BatchApplyResult> {
  const tally = emptyTally();

  for (const entry of entries) {
    const crdName = catalogCrdName(entry.name, entry.project_id);
    const verdict = await applyCatalogEntry(deps, entry, crdName);

    if (verdict.state === "transient") {
      return { kind: "transient", message: verdict.message };
    }
    recordVerdict(tally, entry, verdict);
  }

  return { kind: "ok", tally };
}

// A tally that has seen nothing yet.
function emptyTally(): BatchTally {
  return { applied: 0, deleted: 0, refused: [], reports: [] };
}

async function applyCatalogEntry(
  deps: CatalogSyncTickDeps,
  entry: CatalogEventsResponse["entries"][number],
  crdName: string,
): Promise<EntryVerdict> {
  try {
    return await writeCatalogEntry(deps, entry, crdName);
  } catch (err) {
    return classifyApplyError(err, crdName);
  }
}

// The write itself: delete what the row cleared, refuse what it will not take, otherwise land the pair. Throws — the caller classifies, because whether a failure is transient decides if the loop acks past it.
async function writeCatalogEntry(
  deps: CatalogSyncTickDeps,
  entry: CatalogEventsResponse["entries"][number],
  crdName: string,
): Promise<EntryVerdict> {
  if (entry.definition === null) {
    await deps.catalog.deletePair(crdName);

    return { state: "deleted" };
  }

  return landPair(deps, entry.definition, crdName);
}

/** Land one catalog entry as a CRD pair. */
// Lands the recipe and its station together, unless this cluster refuses the definition.
async function landPair(
  deps: CatalogSyncTickDeps,
  definition: NonNullable<
    CatalogEventsResponse["entries"][number]["definition"]
  >,
  crdName: string,
): Promise<EntryVerdict> {
  const refusal = refusalVerdict(definition, crdName, deps);

  if (refusal) {
    return refusal;
  }
  await deps.catalog.applyPair(agentDefToCrds(definition, deps.crdOptions));

  return { state: "applied" };
}

// Why this cluster will not take the entry, if it will not. A refusal is PERMANENT for this (row, cluster) pair, so the loop acks past it rather than re-serving — re-serving head-of-line blocked the tail for 2h on 2026-09-01.
function refusalVerdict(
  definition: NonNullable<
    CatalogEventsResponse["entries"][number]["definition"]
  >,
  crdName: string,
  deps: CatalogSyncTickDeps,
): EntryVerdict | null {
  const refusal = validateCatalogEntry(definition, deps.crdOptions);

  return refusal === null
    ? null
    : { state: "refused", detail: `${crdName}: ${refusal}`, reason: refusal };
}

// A 400/422 can never succeed, so it refuses; anything else is transient and keeps the ack so the batch re-serves.
function classifyApplyError(err: unknown, crdName: string): EntryVerdict {
  if (isPermanentApplyError(err)) {
    const reason = `${errorMessage(err)} (pair may be half-applied — Station half lands first)`;

    return { state: "refused", detail: `${crdName}: ${reason}`, reason };
  }

  return {
    state: "transient",
    message: `catalog entry ${crdName} failed to land: ${errorMessage(err)}`,
  };
}

function recordVerdict(
  tally: BatchTally,
  entry: CatalogEventsResponse["entries"][number],
  verdict: Exclude<EntryVerdict, { state: "transient" }>,
): void {
  countVerdict(tally, verdict);
  tally.reports.push({
    name: entry.name,
    projectId: entry.project_id,
    state: verdict.state,
    reason: "reason" in verdict ? verdict.reason : null,
  });
}

// Counts one verdict. Applied and deleted are tallied as numbers while refused keeps its DETAIL — a count of refusals tells nobody which entries this cluster will not take.
function countVerdict(
  tally: BatchTally,
  verdict: Exclude<EntryVerdict, { state: "transient" }>,
): void {
  if (verdict.state === "applied") {
    tally.applied += 1;
  }

  if (verdict.state === "deleted") {
    tally.deleted += 1;
  }

  if (verdict.state === "refused") {
    tally.refused.push(verdict.detail);
  }
}
