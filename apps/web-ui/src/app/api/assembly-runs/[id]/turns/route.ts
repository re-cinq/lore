export const dynamic = "force-dynamic";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { serverError } from "@/lib/api-error";
import { forwardedPagingQuery, proxyJson } from "@/lib/floor-proxy";

// Sibling of ./events: proxies UNTRUNCATED turns to the Floor's /api/agent-turns/{id} (#1148) for the on-demand full-transcript view; same 401→404→403 auth ladder.
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
      `${floorUrl}/api/agent-turns/${encodeURIComponent(id)}${query}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: req.signal },
    );

    return proxyJson(upstream);
  } catch (err) {
    return serverError("assembly-line-run-turns", err);
  }
}
