import { z } from "zod";
import type { ColumnMap } from "../../lib/row.js";

/** `lore.github_installations` — the GitHub App installations Lore can act through, one per account (org or user): GitHub allows one installation of an App per account, so `accountLogin` is unique — case-insensitively, as GitHub logins are. A repo is served by the installation of its owner. */

export const GithubAccountTypeSchema = z.enum(["Organization", "User"]);

export const GithubRepositorySelectionSchema = z.enum(["all", "selected"]);

export const GithubInstallationSchema = z.object({
  /** String-encoded bigint: GitHub ids are int64. */
  installationId: z.string(),
  accountLogin: z.string(),
  accountType: GithubAccountTypeSchema,
  /** `all` covers every repo of the account; `selected` only the repos chosen at install time. */
  repositorySelection: GithubRepositorySelectionSchema,
  /** Set while the account has suspended the App: tokens cannot be minted through it. */
  suspendedAt: z.date().nullable(),
  installedAt: z.date(),
  updatedAt: z.date(),
});

export type GithubInstallation = z.infer<typeof GithubInstallationSchema>;

export const GITHUB_INSTALLATION_COLUMNS = {
  installationId: "installation_id",
  accountLogin: "account_login",
  accountType: "account_type",
  repositorySelection: "repository_selection",
  suspendedAt: "suspended_at",
  installedAt: "installed_at",
  updatedAt: "updated_at",
} as const satisfies ColumnMap<GithubInstallation>;

export const GITHUB_INSTALLATION_TABLE = "lore.github_installations";
