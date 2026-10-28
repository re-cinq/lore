import { sessionToken } from "@/lib/session-token";

export interface LoreApiConfig {
  apiUrl: string;
  token: string;
}

/** The Authorization header for a config, or none while there is no session. */
export function bearerHeaders(
  config: LoreApiConfig | null,
): Record<string, string> {
  return config ? { authorization: `Bearer ${config.token}` } : {};
}

/** lore-api's URL and the signed-in person's session token, or null when either is missing. */
export async function resolveLoreApiConfig(): Promise<LoreApiConfig | null> {
  const apiUrl = process.env.LORE_API_URL;
  const token = await sessionToken();

  return apiUrl && token ? { apiUrl, token } : null;
}
