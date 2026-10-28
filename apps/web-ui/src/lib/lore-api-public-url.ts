/** Where the browser reaches lore-api, for the sign-in redirect: the server may talk to it in-cluster, but the browser cannot. */
export function loreApiPublicUrl(
  env: Record<string, string | undefined>,
): string | undefined {
  return (env.LORE_API_PUBLIC_URL || env.LORE_API_URL)?.replace(/\/$/, "");
}
