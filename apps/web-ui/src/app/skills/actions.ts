"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { apiFetch } from "@/lib/api/client";
import type { ApiResult } from "@/lib/api/result";
import { failureMessage } from "@/lib/failure-message";
import { composeSkillContent } from "./skill-content";

const WRITE_TIMEOUT_MS = 5000;

/** What the person typed, handed back after a refusal because React resets the form once its action returns. */
export interface SkillFormValues {
  name: string;
  title: string;
  description: string;
  model: string;
  content: string;
  enabled: boolean;
}

export interface SkillFormState {
  error?: string;
  values?: SkillFormValues;
}

export async function deleteSkill(name: string): Promise<{ error?: string }> {
  const result = await writeSkill("DELETE", `/${encodeURIComponent(name)}`);

  if (result.status !== "ok") {
    return { error: failureMessage(result) };
  }

  revalidatePath("/skills");

  return {};
}

export async function createSkill(
  _prev: SkillFormState,
  formData: FormData,
): Promise<SkillFormState> {
  const values = readValues(formData);

  return settle(
    await writeSkill("POST", "", {
      name: values.name,
      ...toRequestBody(values),
    }),
    values,
  );
}

export async function updateSkill(
  name: string,
  _prev: SkillFormState,
  formData: FormData,
): Promise<SkillFormState> {
  const values = readValues(formData);

  return settle(
    await writeSkill(
      "PUT",
      `/${encodeURIComponent(name)}`,
      toRequestBody(values),
    ),
    values,
  );
}

function writeSkill(
  method: "POST" | "PUT" | "DELETE",
  suffix: string,
  body?: object,
): Promise<ApiResult> {
  return apiFetch("lore-api", `/api/skill-definitions${suffix}`, {
    method,
    body,
    timeoutMs: WRITE_TIMEOUT_MS,
  });
}

function settle(result: ApiResult, values?: SkillFormValues): SkillFormState {
  if (result.status === "ok") {
    revalidatePath("/skills");
    redirect("/skills");
  }

  return { error: failureMessage(result), values };
}

function readValues(formData: FormData): SkillFormValues {
  const text = (field: string) => String(formData.get(field) ?? "");

  const fields = {
    name: text("name"),
    title: text("title"),
    description: text("description"),
    model: text("model"),
  };

  return {
    ...fields,
    content: composeSkillContent({
      ...fields,
      extraFrontmatter: text("extra_frontmatter"),
      body: text("content"),
    }),
    enabled: formData.get("enabled") === "yes",
  };
}

function toRequestBody({ name: _name, ...values }: SkillFormValues) {
  return {
    ...values,
    description: values.description || undefined,
    model: values.model || null,
  };
}
