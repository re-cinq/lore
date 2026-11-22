// Whether the person who minted a token is still an active member of the org: asked of GitHub as Lore's App once the last answer is five minutes old, and a removed person loses every token and session they hold (FR-045, FR-046, FR-048, FR-049).

import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { buildOctokit } from "@re-cinq/lore-shared/project/lib/platform-github-auth.js";
import type { Pool } from "pg";

/** How long an answer about a maker is believed (FR-045). */
export const MAKER_ANSWER_TTL_MS = 5 * 60_000;

export interface MintedTokenMaker {
  githubId: number;
  login: string | null;
  /** The newest of the last answer and the token's own creation, which the sign-in vouched for. */
  answeredAt: Date;
}

export type MembershipOf = (login: string) => Promise<boolean>;

/** True while the maker may keep using the token; false once they were found no longer active, with every token and session of theirs revoked. A GitHub 403 or any failure to ask is a fault of the install: it throws 502 and neither admits nor revokes (FR-043, FR-142). */
export async function makerStillMember(
  pool: Pool,
  maker: MintedTokenMaker,
  isMember: MembershipOf = activeMemberOfOrg,
  now: number = Date.now(),
): Promise<boolean> {
  if (!needsAsking(maker, now)) {
    return true;
  }
  const member = await askedOrInstallFault(isMember, maker.login ?? "");

  await (member ? stampAnswer : revokeEverythingOf)(pool, maker.githubId);

  return member;
}

function needsAsking(maker: MintedTokenMaker, now: number): boolean {
  const stale = now - maker.answeredAt.getTime() >= MAKER_ANSWER_TTL_MS;

  return stale && Boolean(process.env.GITHUB_ORG) && Boolean(maker.login);
}

async function stampAnswer(pool: Pool, githubId: number): Promise<void> {
  await pool.query(
    `UPDATE pipeline.api_tokens SET membership_checked_at = now()
       WHERE github_id = $1`,
    [githubId],
  );
}

/** Every token the person minted and every session of theirs (FR-048, FR-049). */
async function revokeEverythingOf(pool: Pool, githubId: number): Promise<void> {
  await pool.query(
    `UPDATE pipeline.api_tokens SET revoked_at = now()
       WHERE github_id = $1 AND revoked_at IS NULL`,
    [githubId],
  );
}

async function askedOrInstallFault(
  isMember: MembershipOf,
  login: string,
): Promise<boolean> {
  try {
    return await isMember(login);
  } catch (err) {
    console.warn(
      `[maker-membership] GitHub could not say whether ${login} is still in the org: ${(err as Error).message}`,
    );
    throw apiError(502)("GitHub could not confirm org membership");
  }
}

/** `GET /orgs/{org}/memberships/{login}` with the installation's token; a 404 is a person who is not in the org, any other failure throws. */
async function activeMemberOfOrg(login: string): Promise<boolean> {
  const org = process.env.GITHUB_ORG ?? "";
  const { rest } = await buildOctokit(process.env);

  try {
    const { data: membership } = await rest.orgs.getMembershipForUser({
      org,
      username: login,
    });

    return membership.state === "active";
  } catch (err) {
    if ((err as { status?: number }).status === 404) {
      return false;
    }
    throw err;
  }
}
