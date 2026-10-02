export function clientAddress(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
): string {
  return forwardedClient(forwardedFor) ?? remoteAddress ?? "unknown";
}

function forwardedClient(
  forwardedFor: string | string[] | undefined,
): string | undefined {
  const hops = trustedHops();
  const header = [forwardedFor].flat().join(",");

  if (hops === 0 || !header) {
    return undefined;
  }
  const parts = header.split(",").map((part) => part.trim());

  return parts[parts.length - hops] || undefined;
}

function trustedHops(): number {
  const hops = Number(process.env.LORE_TRUSTED_PROXY_HOPS);

  return Number.isInteger(hops) && hops > 0 ? hops : 0;
}
