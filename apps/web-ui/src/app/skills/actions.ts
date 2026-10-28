"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resolveLoreApiConfig } from "@/lib/lore-api-config";

export async function deleteSkill(name: string) {
  await sendSkill("DELETE", `/${encodeURIComponent(name)}`);
  revalidatePath("/skills");
  redirect("/skills");
}

export async function createSkill(f: FormData) {
  await sendSkill("POST", "", parseFormData(f));
  revalidatePath("/skills");
  redirect("/skills");
}

export async function updateSkill(name: string, f: FormData) {
  await sendSkill("PUT", `/${encodeURIComponent(name)}`, parseFormData(f));
  revalidatePath("/skills");
  redirect("/skills");
}

/** One skill-definition write, made with the signed-in person's session token. */
async function sendSkill(
  method: "POST" | "PUT" | "DELETE",
  suffix: string,
  body?: unknown,
) {
  const config = await resolveLoreApiConfig();

  await fetch(`${config?.apiUrl ?? ""}/api/skill-definitions${suffix}`, {
    method,
    signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      ...(config ? { authorization: `Bearer ${config.token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
