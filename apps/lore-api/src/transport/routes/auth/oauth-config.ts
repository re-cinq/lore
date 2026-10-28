// What lore-api needs to run the GitHub sign-in: the OAuth app, its own public address (GitHub calls back there), and the UI and org it serves.

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  uiUrl: string | undefined;
  org: string | undefined;
}

type Env = Record<string, string | undefined>;

/** The sign-in's settings, or null while the OAuth app or the public address is not configured. */
export function oauthConfigFrom(env: Env): OAuthConfig | null {
  const clientId = env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET;
  const apiUrl = env.LORE_API_URL;

  if (!clientId || !clientSecret || !apiUrl) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    apiUrl: apiUrl.replace(/\/$/, ""),
    uiUrl: blankToUndefined(env.LORE_UI_URL),
    org: blankToUndefined(env.GITHUB_ORG),
  };
}

/** Where GitHub sends the person back to after they consent. */
export function callbackUrl(config: OAuthConfig): string {
  return `${config.apiUrl}/api/auth/callback`;
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value || undefined;
}
