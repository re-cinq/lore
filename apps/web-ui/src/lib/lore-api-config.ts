export interface LoreApiConfig {
  apiUrl: string;
  token: string;
}

/** lore-api's URL + bearer token, or null when either env var is unset. */
export function resolveLoreApiConfig(): LoreApiConfig | null {
  const apiUrl = process.env.LORE_API_URL;
  const token = process.env.LORE_INGEST_TOKEN;

  if (!apiUrl || !token) {
    return null;
  }

  return { apiUrl, token };
}
