export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { resolveLoreApiConfig } from "@/lib/lore-api-config";
import { forwardQueryParams } from "@/lib/forward-query-params";
import { serverError } from "@/lib/api-error";

// Thin authenticated proxy to lore-api's /api/analytics/spend-window — the browser holds a session, never the ingest token.
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiConfig = resolveLoreApiConfig();

    if (!apiConfig) {
      return NextResponse.json(
        { error: "LORE_API_URL/LORE_INGEST_TOKEN not configured" },
        { status: 500 },
      );
    }

    const upstream = new URL(`${apiConfig.apiUrl}/api/analytics/spend-window`);

    forwardQueryParams(new URL(req.url), upstream, ["from", "to"]);

    const res = await fetch(upstream, {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${apiConfig.token}` },
    });
    const body: unknown = await res.json().catch(() => ({
      error: `lore-api returned ${res.status}`,
    }));

    return NextResponse.json(body, { status: res.ok ? 200 : res.status });
  } catch (err) {
    return serverError("spend-window", err);
  }
}
