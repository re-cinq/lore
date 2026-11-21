// What lore-api needs to run the GitHub sign-in: the GitHub App client, the token encryption key, its own public address (GitHub calls back there), and the UI and org it serves.

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  uiUrl: string | undefined;
  org: string | undefined;
  tokenEncryptionKey?: string;
}

type Env = Record<string, string | undefined>;

/** The sign-in's settings, or null while the GitHub App client, encryption key, or public address is not configured. */
export function oauthConfigFrom(env: Env): OAuthConfig | null {
  const clientId = env.GITHUB_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET;
  const apiUrl = env.LORE_API_URL;
  const tokenEncryptionKey = env.LORE_USER_TOKEN_ENCRYPTION_KEY;

  if (!clientId || !clientSecret) {
    return null;
  }

  if (!apiUrl || !tokenEncryptionKey) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    apiUrl: apiUrl.replace(/\/$/, ""),
    uiUrl: blankToUndefined(env.LORE_UI_URL),
    org: blankToUndefined(env.GITHUB_ORG),
    tokenEncryptionKey,
  };
}

/** Where GitHub sends the person back to after they consent. */
export function callbackUrl(config: OAuthConfig): string {
  return `${config.apiUrl}/api/auth/callback`;
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value || undefined;
}
