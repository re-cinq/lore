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
    auto_merge: autoMergeBlock(formData),
  };

  const trustLevel = formData.get("trust_level") as string;

  if (trustLevel) {
    updates.trust = { level: trustLevel, auto_promote_threshold: 3 };
  }

  return withoutUndefined(updates);
}

const AUTO_MERGE_APPROVERS = ["none", "lore-reviewer"];

/** Undefined when the approver is missing, unknown or unchanged: lore-api puts every lore-reviewer write behind two-key. */
function autoMergeBlock(formData: FormData): { approver: string } | undefined {
  const approver = formData.get("auto_merge_approver") as string | null;
  const saved = formData.get("auto_merge_approver_saved");

  return approver &&
    AUTO_MERGE_APPROVERS.includes(approver) &&
    approver !== saved
    ? { approver }
    : undefined;
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
