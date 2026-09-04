// The overview page is a container excluded from coverage, so anything that decides rather than fetches lives here.

/** The repo record as the overview reads it: everything optional, because a repo may not be onboarded at all. */
export interface RepoEnrollmentRecord {
  onboarded_at?: string | Date | null;
  onboarding_pr_merged?: boolean | null;
  onboarding_pr_url?: string | null;
  last_ingested_at?: string | Date | null;
  team?: string | null;
}

/** pg returns TIMESTAMPTZ columns as Date objects — normalize to ISO strings. */
export function isoTimestamp(value: unknown): string | null {
  return value ? new Date(value as string | Date).toISOString() : null;
}

/** The enrollment ladder's view of the repo record: when it was onboarded, whether that PR merged, and when it was last ingested. A missing record reads as not onboarded, never as onboarded-with-blanks. */
export function enrollmentFromRepo(repoInfo: RepoEnrollmentRecord | null) {
  const record = repoInfo ?? {};

  return {
    onboarded: !!repoInfo,
    onboardedAt: isoTimestamp(record.onboarded_at),
    onboardingPrMerged: record.onboarding_pr_merged === true,
    onboardingPrUrl: record.onboarding_pr_url ?? null,
    lastIngestedAt: isoTimestamp(record.last_ingested_at),
    team: record.team ?? null,
  };
}

/** A hook still being set up by hand needs its secret pasted into GitHub; a configured one must never have it fetched, because the secret is admin-scoped. */
export function needsWebhookSecret<T extends { state: string }>(
  webhook: T | null,
): webhook is T {
  return webhook !== null && webhook.state !== "configured";
}

/** The two settings keys the overview reads out of the record's opaque JSONB. */
export function overviewSettings(settings: unknown) {
  const parsed = (settings ?? {}) as {
    dark_factory?: { enabled?: boolean };
    trust?: { level?: string };
  };

  return {
    darkFactoryEnabled: parsed.dark_factory?.enabled === true,
    trustLevel: parsed.trust?.level ?? "unset",
  };
}
