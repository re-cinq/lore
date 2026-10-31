import type { Requester, UtopiaSource } from "./utopia-client.js";

/** What Utopia reads from a source's `config`; `extract: false` keeps its documents searchable but runs no entity extraction over them. */
export interface SourceConfig {
  extract?: boolean;
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
