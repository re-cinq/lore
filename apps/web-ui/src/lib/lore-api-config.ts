import { sessionToken } from "@/lib/session-token";

export interface LoreApiConfig {
  apiUrl: string;
  token: string;
}

/** lore-api's URL and the signed-in person's session token, or null when either is missing. */
export async function resolveLoreApiConfig(): Promise<LoreApiConfig | null> {
  const apiUrl = process.env.LORE_API_URL;
  const token = await sessionToken();

  return apiUrl && token ? { apiUrl, token } : null;
}
