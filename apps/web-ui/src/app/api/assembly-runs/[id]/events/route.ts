export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { proxyUpstreamStatus, serverError } from "@/lib/api-error";

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
    const incoming = new URL(req.url).searchParams;
    const forwarded = new URLSearchParams();

    for (const key of ["after", "limit"]) {
      const value = incoming.get(key);

      if (value !== null) {
        forwarded.set(key, value);
      }
    }

    const query = forwarded.size === 0 ? "" : `?${forwarded}`;
    const upstream = await fetch(
      `${floorUrl}/api/agent-events/${encodeURIComponent(id)}${query}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: req.signal },
    );
    const body = await upstream.text();

    return new NextResponse(body, {
      status: proxyUpstreamStatus(upstream.status),
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return serverError("assembly-line-run-events", err);
  }
}
