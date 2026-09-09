// Writes episode to Floor; auto-merge stays Floor-side (ADR-031); best-effort never fails.

import { eventLine, type NodeResult } from "@re-cinq/lore-assembly-lines";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

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

async function postEpisode(input: StationInput): Promise<void> {
  const baseUrl = process.env.LORE_API_URL;

  // no API wired → nothing to write (local/dev)
  if (!baseUrl) {
    return;
  }
  const res = await fetch(`${baseUrl}/api/episode`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: episodeHeaders(),
    body: JSON.stringify({
      content: episodeContent(input),
      source: "retrospective-station",
      ref: input.branch,
    }),
  });

  if (!res.ok) {
    throw new Error(`episode write failed: ${res.status}`);
  }
}

// The station token where there is one, falling back to the ingest token. Absent is allowed: a local run against an unauthenticated API still writes its episode rather than refusing.
function episodeHeaders(): Record<string, string> {
  const token = process.env.LORE_STATION_TOKEN ?? process.env.LORE_INGEST_TOKEN;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (token) {
    headers["authorization"] = `Bearer ${token}`;
  }

  return headers;
}

// What the run reached, in one sentence. The episode is read back by fact extraction rather than by a person, so it names the run, the repo and the branch instead of reading well.
function episodeContent(input: StationInput): string {
  return (
    `Assembly line ${input.assembly_run_id} reached its retrospective node for ${input.repo}` +
    ` on ${input.branch}.`
  );
}
