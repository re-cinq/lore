import type { components } from "@/lib/api/schema";
import { parseDigestBlock } from "./settings-digest";
import { parsePublicMirror } from "./settings-mirror";
import { parseReleasePatch } from "./settings-release";

type StoredSettings = NonNullable<components["schemas"]["Repo"]["settings"]>;

/** `stored` is what the repository saved now: the mirror and release fields send only what differs from it. */
export function parseSettingsForm(
  formData: FormData,
  stored: StoredSettings = {},
) {
  const updates = settingsFields(formData, stored);
  const trustLevel = formData.get("trust_level") as string;

  if (trustLevel) {
    updates.trust = { level: trustLevel, auto_promote_threshold: 3 };
  }

  return withoutUndefined(updates);
}

function settingsFields(
  formData: FormData,
  stored: StoredSettings,
): Record<string, unknown> {
  const selectedRepos = formData.getAll("cross_repo_repos") as string[];

  return {
    task_types: commaList(formData, "task_types"),
    cross_repo: selectedRepos.length > 0,
    cross_repo_repos: selectedRepos,
    slack_channel_id: optionalText(formData, "slack_channel_id"),
    dispatch_label: optionalText(formData, "dispatch_label"),
    dispatch_default_type: optionalText(formData, "dispatch_default_type"),
    digest: parseDigestBlock(formData),
    auto_merge: minAgeBlock(formData),
    implementation_loop: doneCheckBlock(formData),
    base_image: baseImageField(formData),
    public_mirror: parsePublicMirror(formData, stored.public_mirror),
    release: parseReleasePatch(formData, stored.release),
  };
}

/** A chosen base image sets the key, an empty selection clears it to null, and a form without the control leaves it undefined. */
function baseImageField(formData: FormData): string | null | undefined {
  if (!formData.has("base_image")) {
    return undefined;
  }

  return ((formData.get("base_image") as string) || "").trim() || null;
}

/** The auto-merge loop's one setting; a blank or not-whole number of hours leaves the stored one alone. The loop's on/off switch lives on the Loops tab, and lore-api merges this block into the stored one. */
function minAgeBlock(
  formData: FormData,
): { min_age_hours: number } | undefined {
  const raw = (
    (formData.get("auto_merge_min_age_hours") as string) || ""
  ).trim();
  const hours = Number(raw);
  const wholeHours = Number.isInteger(hours) && hours >= 0;

  return raw !== "" && wholeHours ? { min_age_hours: hours } : undefined;
}

/** The implementation loop's done check, a checkbox, so an unticked box is an absent field and means false. The loop's on/off switch lives on the Loops tab, and lore-api merges this block into the stored one. */
function doneCheckBlock(formData: FormData): { done_check: boolean } {
  return {
    done_check: formData.get("implementation_loop_done_check") === "on",
  };
}

/** A comma-separated field as its non-empty, trimmed parts. */
function commaList(formData: FormData, name: string): string[] {
  return ((formData.get(name) as string) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A text field, or undefined when blank — the caller drops undefined rather than writing an empty string. */
function optionalText(formData: FormData, name: string): string | undefined {
  return ((formData.get(name) as string) || "").trim() || undefined;
}

/** Drop the keys that came back undefined, so a blank field leaves the stored value alone. */
function withoutUndefined(
  updates: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of Object.keys(updates)) {
    if (updates[key] === undefined) {
      delete updates[key];
    }
  }

  return updates;
}
