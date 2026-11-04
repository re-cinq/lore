export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { authorizeSessionLoreApi } from "@/lib/lore-api-access";
import { repoRoute } from "@/lib/repo-route";

export const GET = repoRoute(
  "context-preview",
  async (fullName, searchParams) => {
    const { query, ...options } = parsePreviewParams(searchParams);

    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    return previewResponse(fullName, query, options);
  },
);

interface PreviewOptions {
  template: string;
  /** `&backend=…` when the page named one, else empty so the repo's setting chooses. */
  backend: string;
  debug: string;
}

function parsePreviewParams(
  searchParams: URLSearchParams,
): PreviewOptions & { query: string | null } {
  const query = searchParams.get("query");
  const template = searchParams.get("template") || "implementation";
  const named = searchParams.get("backend");
  const backend = named ? `&backend=${encodeURIComponent(named)}` : "";
  const debug = searchParams.get("debug") === "1" ? "&debug=1" : "";

  return { query, template, backend, debug };
}

/** The context builder (lore-v2) asks a model several questions, so it gets two minutes where a template assembly needs seconds. */
const PREVIEW_TIMEOUT_MS = 120_000;

/** The authorized half: the session's lore-api credentials, then the same `/api/context` call a task runner makes. */
async function previewResponse(
  fullName: string,
  query: string,
  { template, backend, debug }: PreviewOptions,
) {
  // Deliberately no per-repo GitHub check: this preview shows the same org-wide context every repo tab already shows.
  const gate = await authorizeSessionLoreApi();

  if (gate instanceof NextResponse) {
    return gate;
  }
  const { apiUrl, token } = gate;
  const upstream = await fetch(
    `${apiUrl}/api/context?repo=${encodeURIComponent(fullName)}&query=${encodeURIComponent(query)}&template=${encodeURIComponent(template)}${backend}${debug}`,
    {
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
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
