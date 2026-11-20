import { randomUUID } from "node:crypto";
import type { SeedRepo } from "./settings-memory.js";
import type { RepoRecord } from "./settings-port.js";

export function toRepoRecord(row: SeedRepo): RepoRecord {
  return {
    ...repoIdentity(row),
    ...repoMeta(row),
    ...repoOnboarding(row),
    ...repoExtras(row),
  };
}

function repoIdentity(
  row: SeedRepo,
): Pick<RepoRecord, "id" | "owner" | "name" | "fullName"> {
  const [owner, name] = repoNameParts(row.full_name);

  return { id: row.id ?? randomUUID(), owner, name, fullName: row.full_name };
}

function repoNameParts(fullName: string): [string, string] {
  const [owner = "", name = ""] = fullName.split("/");

  return [owner, name];
}

function repoMeta(
  row: SeedRepo,
): Pick<RepoRecord, "team" | "onboardedAt" | "lastIngestedAt"> {
  return {
    team: row.team ?? null,
    onboardedAt: row.onboarded_at ?? new Date(0),
    lastIngestedAt: row.last_ingested_at ?? null,
  };
}

function repoOnboarding(
  row: SeedRepo,
): Pick<RepoRecord, "onboardingPrUrl" | "onboardingPrMerged"> {
  return {
    onboardingPrUrl: row.onboarding_pr_url ?? null,
    onboardingPrMerged: row.onboarding_pr_merged ?? false,
  };
}

function repoExtras(
  row: SeedRepo,
): Pick<RepoRecord, "settings" | "outcomeStats"> {
  return {
    settings: row.settings ?? null,
    outcomeStats: row.outcome_stats ?? null,
  };
}
