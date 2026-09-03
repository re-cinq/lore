export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { serverError } from "@/lib/api-error";

// Thin authenticated proxy to lore-api's /api/analytics/spend-window — the browser holds a session, never the ingest token.
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiUrl = process.env.LORE_API_URL;
    const token = process.env.LORE_INGEST_TOKEN;

    if (!apiUrl || !token) {
      return NextResponse.json(
        { error: "LORE_API_URL/LORE_INGEST_TOKEN not configured" },
        { status: 500 },
      );
    }

    const incoming = new URL(req.url);
    const upstream = new URL(`${apiUrl}/api/analytics/spend-window`);

    for (const key of ["from", "to"]) {
      const value = incoming.searchParams.get(key);

      if (value !== null) {
        upstream.searchParams.set(key, value);
      }
    }

    const res = await fetch(upstream, {
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}` },
    });
    const body: unknown = await res.json().catch(() => ({
      error: `lore-api returned ${res.status}`,
    }));

    return NextResponse.json(body, { status: res.ok ? 200 : res.status });
  } catch (err) {
    return serverError("spend-window", err);
  }
}
