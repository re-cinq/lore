/** The address the browser used, read from the ingress's forwarded headers: behind the proxy the request's own URL names the pod, so a redirect built from it would send the person there. */
export function requestOrigin(headers: Headers): string {
  const proto = firstOf(headers.get("x-forwarded-proto")) ?? "http";
  const host = firstOf(headers.get("x-forwarded-host")) ?? headers.get("host");

  return `${proto}://${host}`;
}

/** The first of a comma-separated list, which is the one the client itself asked for. */
function firstOf(value: string | null): string | null {
  const [first = ""] = (value ?? "").split(",");

  return first.trim() || null;
}
