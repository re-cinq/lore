export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchAssemblyLineRun } from "@/lib/assembly-line-runs";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

/**
 * POST /api/assembly-lines/[id]/rerun — the "Rerun from here" button's backend
 * (specs/fork-rerun-from-node). Authorizes the user against the run's repo,
 * then proxies to the Floor's /api/assembly-lines/{id}/rerun (the UI has no
 * DB write path for assembly lines); the Floor loads the current definition
 * and supplies the drift-guard hash. Body is the button's form field
 * (node_id). Redirects to the new fork's run page on success.
 *
 * The auth ladder is cloned from the events proxy in the same order:
 * session (401) → run lookup (404) → repo access (403).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const session = (await getServerSession(authOptions)) as {
      accessToken?: string;
    } | null;

    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const run = await fetchAssemblyLineRun(id);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (!(await userCanAccessRepo(session.accessToken, run.repo))) {
      return NextResponse.json(
        { error: "Access denied — you do not have access to this repo" },
        { status: 403 },
      );
    }

    const form = await req.formData();
    const nodeId = String(form.get("node_id") ?? "");

    if (!nodeId) {
      return NextResponse.json(
        { error: "node_id is required" },
        { status: 400 },
      );
    }

    const floorUrl = process.env.LORE_FLOOR_URL;
    const token = process.env.LORE_INGEST_TOKEN;

    if (!floorUrl || !token) {
      return NextResponse.json(
        { error: "LORE_FLOOR_URL/LORE_INGEST_TOKEN not configured" },
        { status: 500 },
      );
    }

    const upstream = await fetch(
      `${floorUrl}/api/assembly-lines/${encodeURIComponent(id)}/rerun`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ node_id: nodeId }),
      },
    );

    if (!upstream.ok) {
      // The Floor's refusal (drift guard, non-terminal source, unknown node)
      // names WHY the fork was refused — surface it rather than a bare status.
      const detail = await upstream
        .json()
        .then((b: { message?: string }) => b.message)
        .catch(() => undefined);

      return NextResponse.json(
        {
          error: detail
            ? `Floor refused the rerun: ${detail}`
            : `Floor returned ${upstream.status}`,
        },
        { status: 502 },
      );
    }

    const { started } = (await upstream.json()) as { started: string };
    const base = req.headers.get("referer") ?? new URL(req.url).origin;

    return NextResponse.redirect(new URL(`/assembly-lines/${started}`, base), {
      status: 303,
    });
  } catch (err) {
    return serverError("assembly-line-rerun", err);
  }
}
