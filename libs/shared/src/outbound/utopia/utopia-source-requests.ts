import type { Requester, UtopiaSource } from "./utopia-client.js";

/** What Utopia reads from a source's `config`: `extract: false` keeps its documents searchable but runs no entity extraction over them; `names: "identity"` on a statements source says every name it pushes identifies one thing, so Utopia attaches each to its exact name, embeds none and proposes no duplicate pair for them (Utopia decision 0071). */
export interface SourceConfig {
  extract?: boolean;
  names?: "identity";
}

export interface SessionCall {
  request: Requester;
  bearer: string;
}

export async function createSource(
  { request, bearer }: SessionCall,
  kbId: string,
  {
    kind,
    name,
    config = {},
  }: { kind: "statements" | "api"; name: string; config?: SourceConfig },
): Promise<UtopiaSource> {
  const created = await request<{
    ingest_token: string;
    source: { id: string };
  }>(`/kbs/${kbId}/sources`, {
    token: bearer,
    json: { kind, name, config },
  });

  return { id: created.source.id, key: created.ingest_token };
}

export async function patchSourceConfig(
  { request, bearer }: SessionCall,
  kbId: string,
  sourceId: string,
  config: SourceConfig,
): Promise<void> {
  await request(`/kbs/${kbId}/sources/${sourceId}`, {
    token: bearer,
    method: "PATCH",
    json: { config },
  });
}

/** Deletes every document the source holds marked missing; a tombstone only marks one, and its facts stand until this runs. Utopia deletes one document at a time, seconds each on a big base, so it waits as long as an import. */
export async function cleanupMissing(
  { request, bearer }: SessionCall,
  kbId: string,
  sourceId: string,
): Promise<void> {
  await request(`/kbs/${kbId}/sources/${sourceId}/missing/cleanup`, {
    token: bearer,
    heavy: true,
  });
}
