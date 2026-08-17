// The retrospective station: write the run's episode from the pod (POST
// /api/episode, the existing write-scoped endpoint). Auto-merge and memory
// curation deliberately stay Floor-side — merge authority never rides in a run
// pod (ADR-031); the Floor triggers them after the retrospective node succeeds.
// Best-effort: an episode-write failure logs but never fails the assembly line
// (the node's job is to mark the run done, not to gate on telemetry).

import { eventLine, type NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

async function postEpisode(input: StationInput): Promise<void> {
  const baseUrl = process.env.LORE_API_URL;

  if (!baseUrl) {
    return;
  } // no API wired → nothing to write (local/dev)
  const token = process.env.LORE_STATION_TOKEN ?? process.env.LORE_INGEST_TOKEN;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (token) {
    headers["authorization"] = `Bearer ${token}`;
  }

  const content =
    `Assembly line ${input.assembly_run_id} reached its retrospective node for ${input.repo}` +
    ` on ${input.branch}.`;
  const res = await fetch(`${baseUrl}/api/episode`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers,
    body: JSON.stringify({
      content,
      source: "retrospective-station",
      ref: input.branch,
    }),
  });

  if (!res.ok) {
    throw new Error(`episode write failed: ${res.status}`);
  }
}

export async function runRetrospectiveStation(
  input: StationInput,
): Promise<NodeResult> {
  try {
    await postEpisode(input);
  } catch (err) {
    console.log(
      eventLine(
        `retrospective episode write failed: ${(err as Error).message}`,
      ),
    );
  }

  return { outcome: "success", extras: { "Lore-Retro": "episode" } };
}
