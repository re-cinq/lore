/** Where the browser opens its one live socket (ADR-048): the deployment's public address, or next to lore-api when it runs on this machine. */
export function liveSocketUrl(
  env: Record<string, string | undefined>,
): string | undefined {
  return (
    env.LORE_WS_URL ??
    (env.LORE_API_URL && `${env.LORE_API_URL.replace(/^http/, "ws")}/api/ws`)
  );
}
