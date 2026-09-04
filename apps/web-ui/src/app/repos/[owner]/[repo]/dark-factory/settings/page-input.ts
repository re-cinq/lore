/** Pure helpers for the Dark Factory settings save action and page load. */

import { resolveDarkFactorySettings } from "@/lib/dark-factory-resolve";
import type { CurrentSettings } from "@/lib/settings-form";

export interface RepoSettings {
  dark_factory?: { execution?: { image?: string } };
}

interface ApiResult<T> {
  status: string;
  data?: T;
}

/** Reads the repo's raw settings blob off a `getRepo` result, or `{}` on a failed read. */
export function repoSettingsOf(
  repoRow: ApiResult<{ settings?: RepoSettings | null }>,
): RepoSettings {
  if (repoRow.status !== "ok") {
    return {};
  }

  return repoRow.data?.settings ?? {};
}

/** Folds the raw `dark_factory` block into the resolved settings the form diffs against. */
export function currentSettingsOf(cur: RepoSettings): CurrentSettings {
  const resolved = resolveDarkFactorySettings(cur.dark_factory ?? null);

  return {
    dark_factory: { ...resolved, execution: cur.dark_factory?.execution },
  };
}

/** The trimmed approval-PR field, or `undefined` when blank. */
export function approvalPrFrom(formData: FormData): string | undefined {
  const raw = formData.get("approval_pr");
  const trimmed = typeof raw === "string" ? raw.trim() : "";

  return trimmed || undefined;
}
