import { z } from "zod";

/** Which store a read answers from while Lore and Utopia run side by side (ADR-052 amendment 2026-10-16): every ingest writes to both, and a read chooses. */
export const KnowledgeBackendSchema = z.enum(["lore", "utopia", "both"]);

export type KnowledgeBackend = z.infer<typeof KnowledgeBackendSchema>;

/** The request's choice wins, then the repo's `settings.context_backend`, then Utopia. */
export function resolveBackend(
  requested?: KnowledgeBackend,
  repoSetting?: KnowledgeBackend,
): KnowledgeBackend {
  return requested ?? repoSetting ?? "utopia";
}

/** What a source with no Utopia reader answers in its place: said out loud, never Lore's data under Utopia's name. */
export function noUtopiaReader(source: string): string {
  return `${source}: no Utopia reader yet`;
}

/** A search's answer for a backend: Lore's hits unless only Utopia was asked for (Lore is then never read), plus a note for the source while Utopia has no reader for it. */
export async function searchBackend<T>(
  backend: KnowledgeBackend,
  source: string,
  searchLore: () => Promise<T[]>,
): Promise<{ results: T[]; notes: string[] }> {
  const results = backend === "utopia" ? [] : await searchLore();

  return { results, notes: backend === "lore" ? [] : [noUtopiaReader(source)] };
}
