/** The address the browser used, read from the ingress's forwarded headers: behind the proxy the request's own URL names the pod, so a redirect built from it would send the person there. */
export function requestOrigin(headers: Headers): string {
  const proto = firstOf(headers.get("x-forwarded-proto")) ?? "http";
  const host = firstOf(headers.get("x-forwarded-host")) ?? headers.get("host");

  return `${proto}://${host}`;
}

function firstOf(value: string | null): string | null {
  return value?.split(",")[0].trim() || null;
}
