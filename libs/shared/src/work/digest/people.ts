import { z } from "zod";
import { enforceTrue } from "../../lib/enforce.js";

/** Who a GitHub login is in Slack (specs/daily-digest FR12): a manual override in the org setting `slack_users` wins, else the person's commit email is looked up in Slack's directory. The digest shows the Slack display name as plain text, never a mention, so nobody is pinged by it. */

/** GitHub login → Slack user id, the org setting `slack_users`. */
export type SlackUsers = Record<string, string>;

const SlackUsersSchema = z.record(
  z.string().min(1),
  z.string().regex(/^[UW][A-Z0-9]+$/),
);

export function parseSlackUsers(raw: string | undefined): SlackUsers {
  if (!raw) {
    return {};
  }
  const parsed = SlackUsersSchema.safeParse(parseJson(raw));

  enforceTrue(
    parsed.success,
    Error,
    `slack_users must map GitHub logins to Slack user ids: ${parsed.error?.message ?? ""}`,
  );

  return parsed.data;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export interface NameDeps {
  override: SlackUsers;
  /** A commit email of the login, or null when none is known. */
  emailOf(login: string): Promise<string | null>;
  slackIdByEmail(email: string): Promise<string | null>;
  slackName(slackUserId: string): Promise<string | null>;
}

/** The Slack display name of each login that resolves; a login left out keeps its GitHub name. One person's failed lookup never costs the others theirs. */
export async function resolveNames(
  logins: string[],
  deps: NameDeps,
): Promise<Record<string, string>> {
  const people = [...new Set(logins)].filter((login) => !isBot(login));
  const named = await Promise.all(
    people.map(
      async (login) =>
        [login, await nameOf(login, deps).catch(() => null)] as const,
    ),
  );

  return Object.fromEntries(
    named.filter(
      (entry): entry is readonly [string, string] => entry[1] !== null,
    ),
  );
}

async function nameOf(login: string, deps: NameDeps): Promise<string | null> {
  const slackId = deps.override[login] ?? (await slackIdOf(login, deps));

  return slackId ? deps.slackName(slackId) : null;
}

async function slackIdOf(
  login: string,
  deps: NameDeps,
): Promise<string | null> {
  const email = await deps.emailOf(login);

  return email ? deps.slackIdByEmail(email) : null;
}

function isBot(login: string): boolean {
  return login.endsWith("[bot]");
}
