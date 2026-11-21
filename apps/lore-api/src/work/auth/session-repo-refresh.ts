// Keeps a person's session repository list at most five minutes old: past that age the list is read again from GitHub with their stored token, replaced only when every page was read, and refused when GitHub gives no fresh answer (FR-032, FR-033, FR-039, FR-140).

import type { Pool } from "pg";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { fetchInstallationRepos } from "../../outbound/github-user-client.js";
import { decryptTokenPair } from "./token-cipher.js";

export const REPOS_MAX_AGE_MS = 5 * 60_000;

export interface SessionRepoState {
  id: string;
  reposRefreshedAt: Date | null;
  encryptedTokens: string | null;
}

interface RefreshSettings {
  key: string;
  installationId: string;
  sealed: string;
}

const REPLACE = `UPDATE pipeline.api_tokens SET repos = $2, repos_refreshed_at = now() WHERE id = $1`;

/** The person's repository list, read again when older than five minutes. A failed refresh leaves the previous list and its old timestamp in place and refuses the read; the next request asks GitHub again. */
export async function refreshedRepos(
  pool: Pool,
  session: SessionRepoState,
  kept: string[],
  fetchRepos: typeof fetchInstallationRepos = fetchInstallationRepos,
): Promise<string[]> {
  const settings = refreshSettings(session);

  if (!settings) {
    return kept;
  }

  const repos = await readFreshRepos(settings, fetchRepos);

  await pool.query(REPLACE, [session.id, repos]);

  return repos;
}

async function readFreshRepos(
  settings: RefreshSettings,
  fetchRepos: typeof fetchInstallationRepos,
): Promise<string[]> {
  try {
    const { accessToken } = decryptTokenPair(settings.sealed, settings.key);
    const all = await fetchRepos(accessToken, settings.installationId);

    return all.map((repo) => repo.full_name);
  } catch {
    throw apiError(503)(
      "repository list is stale and GitHub gave no fresh answer",
    );
  }
}

/** What a refresh needs, or null while the list is fresh or the session holds no stored user token. */
function refreshSettings(session: SessionRepoState): RefreshSettings | null {
  const key = process.env.LORE_USER_TOKEN_ENCRYPTION_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const sealed = session.encryptedTokens;

  if (!isStale(session) || !sealed) {
    return null;
  }

  return key && installationId ? { key, installationId, sealed } : null;
}

function isStale(session: SessionRepoState): boolean {
  const refreshedAt = session.reposRefreshedAt;

  return !refreshedAt || Date.now() - refreshedAt.getTime() >= REPOS_MAX_AGE_MS;
}
