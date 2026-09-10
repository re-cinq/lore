export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { authorizeSessionLoreApi } from "@/lib/lore-api-access";
import { repoRoute } from "@/lib/repo-route";

export const GET = repoRoute(
  "context-preview",
  async (fullName, searchParams) => {
    const { query, template, debug } = parsePreviewParams(searchParams);

    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    return previewResponse(fullName, query, template, debug);
  },
);

function parsePreviewParams(searchParams: URLSearchParams): {
  query: string | null;
  template: string;
  debug: string;
} {
  const query = searchParams.get("query");
  const template = searchParams.get("template") || "implementation";
  const debug = searchParams.get("debug") === "1" ? "&debug=1" : "";

  return { query, template, debug };
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

/** The assembled context, passed through unread. The status is NOT remapped: this route proxies the same endpoint a task runner hydrates from, so what the reader sees is byte-for-byte what a dev session receives on turn 1. */
async function upstreamJson(upstream: Response) {
  const body = await upstream.text();

  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
