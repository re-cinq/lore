export const dynamic = "force-dynamic";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { serverError } from "@/lib/api-error";
import { forwardedPagingQuery, proxyJson } from "@/lib/floor-proxy";

// Session-authed history proxy to the Floor's /api/agent-events/{id}; auth ladder matches the node-logs route (401 → 404 → 403).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const auth = await authorizeAssemblyRunAccess(id);

    if (isAssemblyRunAuthError(auth)) {
      return auth;
    }

    const { floorUrl, token } = auth;
    const query = forwardedPagingQuery(new URL(req.url).searchParams);
    const upstream = await fetch(
      `${floorUrl}/api/agent-events/${encodeURIComponent(id)}${query}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: req.signal },
    );

    return proxyJson(upstream);
  } catch (err) {
    return serverError("assembly-line-run-events", err);
  }
}
