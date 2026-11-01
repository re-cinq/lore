import {
  KnowledgeBackendSchema,
  type KnowledgeBackend,
} from "@re-cinq/lore-shared/knowledge-backend.js";

// Optional, not defaulted: an unset backend lets the API apply the repo's settings.context_backend before falling back to Utopia.
export const backendParam = KnowledgeBackendSchema.optional().describe(
  "utopia (default), lore, or both — compare Lore's stores with Utopia; Utopia sources fill in as their readers land.",
);

/** Only the API reads Utopia; a search the adapter answers offline reads Lore alone, so it refuses a Utopia read rather than answer it with Lore's data. */
export function readsUtopia(
  backend: KnowledgeBackend | undefined,
): backend is "utopia" | "both" {
  return backend === "utopia" || backend === "both";
}

export function backendNeedsApi(backend: KnowledgeBackend): string {
  return `backend ${backend} is answered by the Lore API only; set LORE_API_URL. The offline search reads Lore's stores alone.`;
}
