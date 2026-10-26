"use server";

import { revalidatePath } from "next/cache";

export async function deleteSkill(name: string) {
  const tk = process.env.LORE_ADMIN_TOKEN || process.env.LORE_INGEST_TOKEN;

  await fetch(
    `${process.env.LORE_API_URL ?? ""}/api/skill-definitions/${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
      headers: tk ? { authorization: `Bearer ${tk}` } : undefined,
    },
  );
  revalidatePath("/skills");
}

export async function createSkill(f: FormData) {
  const tk = process.env.LORE_ADMIN_TOKEN || process.env.LORE_INGEST_TOKEN;
  const url = `${process.env.LORE_API_URL || ""}/api/skill-definitions`;
  const headers = {
    "Content-Type": "application/json",
    ...(tk ? { authorization: `Bearer ${tk}` } : {}),
  };

  await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers,
    body: JSON.stringify(parseFormData(f)),
  });
  revalidatePath("/skills");
}

function parseFormData(f: FormData) {
  return {
    name: f.get("name"),
    title: f.get("title"),
    description: f.get("description") || undefined,
    model: f.get("model") || null,
    content: f.get("content"),
    enabled: f.get("enabled") === "on",
  };
}
