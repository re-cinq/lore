import { z } from "zod";

/** Which store a read answers from while Lore and Utopia run side by side (ADR-052 amendment 2026-10-16): every ingest writes to both, and a read chooses. */
export const KnowledgeBackendSchema = z.enum(["lore", "utopia", "both"]);

export type KnowledgeBackend = z.infer<typeof KnowledgeBackendSchema>;

/** What `/api/context` answers from: a knowledge backend through the template assembly, or `lore-v2`, the context builder (#4090) reading Lore's stores. */
export const ContextBackendSchema = z.enum([
  ...KnowledgeBackendSchema.options,
  "lore-v2",
]);

export type ContextBackend = z.infer<typeof ContextBackendSchema>;

/** The store a context backend reads: `lore-v2` reads Lore's. */
export function storeOf(
  backend?: ContextBackend,
): KnowledgeBackend | undefined {
  return backend === "lore-v2" ? "lore" : backend;
}

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

/** A search's answer for a backend. Lore is read unless only Utopia was asked for; Utopia is read through the arm when one is given, else the source says it has no Utopia reader yet. */
export async function searchBackend<T>(
  backend: KnowledgeBackend,
  source: string,
  searchLore: () => Promise<T[]>,
  searchUtopia?: (() => Promise<T[]>) | null,
): Promise<{ results: T[]; notes: string[] }> {
  const readsLore = backend !== "utopia";
  const readsUtopia = backend !== "lore";
  const [lore, utopia] = await Promise.all([
    readsLore ? searchLore() : [],
    readsUtopia && searchUtopia ? searchUtopia() : [],
  ]);
  const notes = readsUtopia && !searchUtopia ? [noUtopiaReader(source)] : [];

  return { results: [...lore, ...utopia], notes };
}
