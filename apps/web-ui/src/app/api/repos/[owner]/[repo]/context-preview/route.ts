export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { serverError } from "@/lib/api-error";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { owner, repo } = await params;
  const fullName = `${owner}/${repo}`;

  const url = new URL(req.url);
  const query = url.searchParams.get("query");
  const template = url.searchParams.get("template") || "implementation";
  const debug = url.searchParams.get("debug") === "1" ? "&debug=1" : "";

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    // Auth is the same session gate every repo tab uses (enforced by
    // middleware + the org check at sign-in). We deliberately do NOT add a
    // per-repo GitHub access check here: the DB-backed Overview/Context/Specs
    // tabs show any onboarded repo's context to any authenticated org member,
    // and this preview is the same org-wide context — just assembled.
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Proxy to the same MCP endpoint the task runners hydrate from, so the
    // preview is byte-for-byte what a dev session receives on turn 1.
    const apiUrl = process.env.LORE_API_URL;
    const apiToken = process.env.LORE_INGEST_TOKEN;

    if (!apiUrl || !apiToken) {
      return NextResponse.json(
        { error: "LORE_API_URL/LORE_INGEST_TOKEN not configured" },
        { status: 500 },
      );
    }

    const upstream = await fetch(
      `${apiUrl}/api/context?repo=${encodeURIComponent(fullName)}&query=${encodeURIComponent(query)}&template=${encodeURIComponent(template)}${debug}`,
      { signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${apiToken}` } },
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
