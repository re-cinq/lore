/** Slack's user directory, read-only: who an email belongs to and what they are called. Needs the bot scopes users:read and users:read.email (scripts/slack-app-manifest.yaml). */
export interface SlackDirectoryPort {
  /** The Slack user id owning `email`, or null when Slack knows nobody by it. */
  idByEmail(email: string): Promise<string | null>;
  /** The name Slack shows for the user: display name, else real name; null for an unknown id. */
  displayName(slackUserId: string): Promise<string | null>;
}
