// Reading the mirror back: a repository's knowledge base searched, and a pushed item fetched by the id Lore pushed it under, both as the Lore person's token (`UTOPIA_TOKEN`), since a source's push key reads nothing.

import {
  parseSearchPage,
  parseStoredDocument,
  type SearchPage,
  type StoredDocument,
} from "../../domain/utopia/read-shapes.js";
import {
  UtopiaError,
  utopiaRequester,
  type Requester,
  type UtopiaClientOptions,
  type UtopiaEnv,
} from "./utopia-client.js";

/** The documents a search recalls from: one source's, whose external id starts with one of the prefixes. Utopia filters before it ranks, so other items in the base take no places. */
export interface SearchScope {
  sourceId: string;
  externalIdPrefixes: string[];
}

export interface SearchWindow {
  /** At most 50; Utopia refuses a window whose `offset + topK` passes 100. */
  topK: number;
  offset: number;
  scope?: SearchScope;
}

export interface UtopiaReads {
  search(kbId: string, q: string, window: SearchWindow): Promise<SearchPage>;
  /** Null when the base holds no live item under that id: never pushed, or tombstoned. */
  documentByExternalId(
    kbId: string,
    sourceId: string,
    externalId: string,
  ): Promise<StoredDocument | null>;
}

/** Null on a deployment that was given no Utopia URL or no token to read it with. */
export function utopiaReadsFrom(
  env: UtopiaEnv,
  options: UtopiaClientOptions = {},
): UtopiaReads | null {
  if (!env.UTOPIA_API_URL || !env.UTOPIA_TOKEN) {
    return null;
  }

  return readsOver(
    utopiaRequester(env.UTOPIA_API_URL, options),
    env.UTOPIA_TOKEN,
  );
}

function readsOver(request: Requester, token: string): UtopiaReads {
  return {
    search: async (kbId, q, window) =>
      parseSearchPage(
        await request<unknown>(`/kbs/${kbId}/search`, {
          token,
          json: searchBody(q, window),
        }),
      ),
    documentByExternalId: (kbId, sourceId, externalId) =>
      request<unknown>(
        `/kbs/${kbId}/sources/${sourceId}/documents/by-external-id?external_id=${encodeURIComponent(externalId)}`,
        { token, method: "GET" },
      ).then(parseStoredDocument, nullWhenNotFound),
  };
}

function searchBody(q: string, { topK, offset, scope }: SearchWindow) {
  return {
    q,
    top_k: topK,
    offset,
    ...(scope && {
      source_id: scope.sourceId,
      external_id_prefixes: scope.externalIdPrefixes,
    }),
  };
}

function nullWhenNotFound(failure: unknown): null {
  if (failure instanceof UtopiaError && failure.status === 404) {
    return null;
  }
  throw failure;
}
