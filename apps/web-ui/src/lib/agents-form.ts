import type { AgentDefinition } from "./agents-mirror";
import type { AgentSaveResult } from "./agents-api";

// Pure FormData→agent payload parsing shared by the new/edit server actions; kept here (not page.tsx) so the branchy bits are unit-tested.

/** K8s resource quantities keyed cpu/memory/ephemeral-storage, as the API's `pod_resources` field expects them. */
export interface PodResources {
  requests?: Record<string, string>;
  limits?: Record<string, string>;
}

export interface ParsedAgentForm {
  name: string;
  isNew: boolean;
  def: Omit<AgentDefinition, "project_id"> & {
    /** null clears a previously saved value — the API treats absence as "leave". */
    pod_resources: PodResources | null;
  };
  approvalPr?: string;
}

const RESOURCE_INPUTS: ReadonlyArray<[field: string, resource: string]> = [
  ["cpu", "cpu"],
  ["memory", "memory"],
  ["ephemeral", "ephemeral-storage"],
];

function resourceBlock(
  fd: FormData,
  kind: "requests" | "limits",
): Record<string, string> | undefined {
  const entries = RESOURCE_INPUTS.flatMap(([field, resource]) => {
    const value = ((fd.get(`res_${kind}_${field}`) as string) || "").trim();

    return value ? [[resource, value] as const] : [];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function parsePodResources(fd: FormData): PodResources | null {
  const requests = resourceBlock(fd, "requests");
  const limits = resourceBlock(fd, "limits");

  if (!requests && !limits) {
    return null;
  }

  return {
    ...(requests ? { requests } : {}),
    ...(limits ? { limits } : {}),
  };
}

function formString(fd: FormData, key: string): string {
  return ((fd.get(key) as string) || "").trim();
}

function orNull(value: string): string | null {
  return value || null;
}

function orDefault(value: string, fallback: string): string {
  return value || fallback;
}

function parseModel(fd: FormData): string | null {
  const modelSel = formString(fd, "model_select");

  if (modelSel === "__custom__") {
    return orNull(formString(fd, "model_custom"));
  }

  return orNull(modelSel);
}

function parseTimeoutMinutes(fd: FormData): number | null {
  const timeoutRaw = formString(fd, "timeout_minutes");

  return timeoutRaw ? Number(timeoutRaw) : null;
}

export function parseAgentForm(fd: FormData): ParsedAgentForm {
  const isNew = fd.get("is_new") === "1";
  const name = isNew ? formString(fd, "name_input") : formString(fd, "name");

  return {
    name,
    isNew,
    def: {
      name,
      model: parseModel(fd),
      timeout_minutes: parseTimeoutMinutes(fd),
      prompt: orNull(formString(fd, "prompt")),
      image: orNull(formString(fd, "image")),
      execution_mode: orDefault(
        formString(fd, "execution_mode"),
        "claude-code",
      ),
      review_required: fd.get("review_required") === "1",
      // Null inherits the org default's config (skills/disallowed_tools/etc) — the form has no field for it.
      config: null,
      pod_resources: parsePodResources(fd),
    },
    approvalPr: formString(fd, "approval_pr") || undefined,
  };
}

export interface AgentFormState {
  error?: string;
  twoKey?: boolean;
}

/** Map an agents-api save result to the form state (ok → {} so the page redirects). */
export function saveResultToState(r: AgentSaveResult): AgentFormState {
  if (r.status === "ok") {
    return {};
  }

  if (r.status === "two_key_required") {
    return { twoKey: true };
  }

  if (r.status === "unconfigured") {
    return { error: "LORE_API_URL / LORE_ADMIN_TOKEN not set" };
  }

  if (r.status === "codeowners_failed") {
    return { error: r.detail || r.code };
  }

  return { error: r.message };
}
