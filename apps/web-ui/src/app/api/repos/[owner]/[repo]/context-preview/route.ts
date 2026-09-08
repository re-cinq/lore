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

/** The session gate and the upstream credentials, or the refusal to send back. Deliberately no per-repo GitHub check: this preview shows the same org-wide context every repo tab already shows. */
async function authorizeContextPreview() {
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

  return apiConfig;
}

/** The assembled context, passed through unread. The status is NOT remapped: this route proxies the same endpoint a task runner hydrates from, so what the reader sees is byte-for-byte what a dev session receives on turn 1. */
async function upstreamJson(upstream: Response) {
  const body = await upstream.text();

  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
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
    const gate = await authorizeContextPreview();

    if (gate instanceof NextResponse) {
      return gate;
    }
    const { apiUrl, token } = gate;
    const upstream = await fetch(
      `${apiUrl}/api/context?repo=${encodeURIComponent(fullName)}&query=${encodeURIComponent(query)}&template=${encodeURIComponent(template)}${debug}`,
      {
        signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    return upstreamJson(upstream);
  } catch (err) {
    return serverError("context-preview", err);
  }
}
