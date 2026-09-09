export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { authorizeSessionLoreApi } from "@/lib/lore-api-access";
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

/** The assembled context, passed through unread. The status is NOT remapped: this route proxies the same endpoint a task runner hydrates from, so what the reader sees is byte-for-byte what a dev session receives on turn 1. */
async function upstreamJson(upstream: Response) {
  const body = await upstream.text();

  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The authorized half: the session's lore-api credentials, then the same `/api/context` call a task runner makes. */
async function previewResponse(
  fullName: string,
  query: string,
  template: string,
  debug: string,
) {
  // Deliberately no per-repo GitHub check: this preview shows the same org-wide context every repo tab already shows.
  const gate = await authorizeSessionLoreApi();

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
    return await previewResponse(fullName, query, template, debug);
  } catch (err) {
    return serverError("context-preview", err);
  }
}
