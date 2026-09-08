// ── General (non-privileged) settings → written directly to the DB ──────────

export function parseSettingsForm(formData: FormData) {
  const selectedRepos = formData.getAll("cross_repo_repos") as string[];
  const updates: Record<string, unknown> = {
    task_types: commaList(formData, "task_types"),
    auto_review: formData.get("auto_review") === "yes",
    cross_repo: selectedRepos.length > 0,
    cross_repo_repos: selectedRepos,
    slack_channel_id: optionalText(formData, "slack_channel_id"),
    dispatch_label: optionalText(formData, "dispatch_label"),
    dispatch_default_type: optionalText(formData, "dispatch_default_type"),
  };

  const trustLevel = formData.get("trust_level") as string;

  if (trustLevel) {
    updates.trust = { level: trustLevel, auto_promote_threshold: 3 };
  }

  return withoutUndefined(updates);
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

export {
  parsePrivilegedChanges,
  type CurrentSettings,
  type PrivilegedPatch,
} from "./settings-form-privileged";
