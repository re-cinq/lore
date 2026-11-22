// The overview page is a container excluded from coverage, so anything that decides rather than fetches lives here.

// Projects five lore.repos columns (models/repo.ts); Date allowed since a raw pg row, not just RepoRecord's wire JSON, can reach this.
// eslint-disable-next-line re-lint/no-row-types-outside-models
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

/** The one settings key the overview reads out of the record's opaque JSONB. */
export function overviewSettings(settings: unknown) {
  const parsed = (settings ?? {}) as {
    trust?: { level?: string };
  };

  return {
    trustLevel: parsed.trust?.level ?? "unset",
  };
}
