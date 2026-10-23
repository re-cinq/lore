import { parseDigestBlock } from "./settings-digest";

export function parseSettingsForm(formData: FormData) {
  const selectedRepos = formData.getAll("cross_repo_repos") as string[];
  const updates: Record<string, unknown> = {
    task_types: commaList(formData, "task_types"),
    cross_repo: selectedRepos.length > 0,
    cross_repo_repos: selectedRepos,
    slack_channel_id: optionalText(formData, "slack_channel_id"),
    dispatch_label: optionalText(formData, "dispatch_label"),
    dispatch_default_type: optionalText(formData, "dispatch_default_type"),
    digest: parseDigestBlock(formData),
    auto_merge: minAgeBlock(formData),
  };

  const trustLevel = formData.get("trust_level") as string;

  if (trustLevel) {
    updates.trust = { level: trustLevel, auto_promote_threshold: 3 };
  }

  return withoutUndefined(updates);
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
