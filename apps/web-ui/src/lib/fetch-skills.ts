import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { failureMessage } from "@/lib/failure-message";
import type { SkillDefinition } from "@/lib/skill-definition";

const READ_TIMEOUT_MS = 5000;

export type LoadedSkills =
  | { status: "ok"; skills: SkillDefinition[] }
  | { status: "failed"; message: string };

export async function fetchSkills(): Promise<LoadedSkills> {
  const result = await apiFetch<components["schemas"]["SkillDefinitionsList"]>(
    "lore-api",
    "/api/skill-definitions",
    { timeoutMs: READ_TIMEOUT_MS },
  );

  if (result.status === "ok") {
    return { status: "ok", skills: result.data.skills };
  }

  return { status: "failed", message: failureMessage(result) };
}
