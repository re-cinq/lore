export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { resolveLoreApiConfig } from "@/lib/lore-api-config";
import { serverError } from "@/lib/api-error";

function parsePreviewParams(url: URL): {
  query: string | null;
  template: string;
  debug: string;
} {
  const query = url.searchParams.get("query");
  const template = url.searchParams.get("template") || "implementation";
  const debug = url.searchParams.get("debug") === "1" ? "&debug=1" : "";

  return { query, template, debug };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;
  const { query, template, debug } = parsePreviewParams(new URL(req.url));

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    // Same session gate as every repo tab; deliberately no per-repo GitHub check — this preview is the same org-wide context those tabs already show.
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Proxy to the same MCP endpoint the task runners hydrate from — preview is byte-for-byte what a dev session receives on turn 1.
    const apiConfig = resolveLoreApiConfig();

    if (!apiConfig) {
      return NextResponse.json(
        { error: "LORE_API_URL/LORE_INGEST_TOKEN not configured" },
        { status: 500 },
      );
    }

    const { apiUrl, token } = apiConfig;
    const upstream = await fetch(
      `${apiUrl}/api/context?repo=${encodeURIComponent(fullName)}&query=${encodeURIComponent(query)}&template=${encodeURIComponent(template)}${debug}`,
      {
        signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const body = await upstream.text();

    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return serverError("context-preview", err);
  }
}
