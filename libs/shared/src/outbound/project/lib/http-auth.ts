/** The request headers every pod-side HTTP adapter sends: JSON, plus the bearer when a token was configured. A pod with no token still talks to an unauthenticated local API, so the header is omitted rather than sent empty. */
export function bearerJsonHeaders(token?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}
