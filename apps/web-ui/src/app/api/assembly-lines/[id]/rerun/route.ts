export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { fetchAssemblyLineRun } from "@/lib/assembly-line-runs";
import { userCanWriteRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

/**
 * POST /api/assembly-lines/[id]/rerun — the "Rerun from here" button's backend
 * (specs/fork-rerun-from-node FR6). Authorizes the user against the run's
 * repo, then proxies to the Floor's /api/assembly-lines/{id}/rerun (the UI has
 * no DB write path for assembly lines); the Floor loads the current definition
 * and supplies the drift-guard hash. Body is the button's form field
 * (node_id); the session identity rides along as the audit-log actor. Returns
 * the fork's line id as JSON — the client-side button navigates.
 *
 * The auth ladder follows the events proxy's order — session (401) → run
 * lookup (404) → repo access (403) — but the access rung is WRITE (push)
 * permission, not the read-shaped check the read proxies use: a fork starts
 * agent runs and pushes commits to the run's branch, so read access to a
 * public repo must not be enough to trigger it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const session = (await getServerSession(authOptions)) as {
      accessToken?: string;
      user?: { name?: string | null; email?: string | null };
    } | null;

    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const run = await fetchAssemblyLineRun(id);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (!(await userCanWriteRepo(session.accessToken, run.repo))) {
      return NextResponse.json(
        { error: "Access denied — rerun requires write access to the repo" },
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

    // Audit actor: null over a fabricated "ui" placeholder — an unknown
    // identity should read as unknown in pipeline.audit_log.
    const actor = session.user?.name ?? session.user?.email ?? null;
    const upstream = await fetch(
      `${floorUrl}/api/assembly-lines/${encodeURIComponent(id)}/rerun`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ node_id: nodeId, actor }),
      },
    );

    if (upstream.status === 409) {
      // The Floor's refusal (drift guard, non-terminal source, unknown node)
      // is an expected state conflict, not a broken upstream: keep it a 409
      // and surface WHY, because "definition hash mismatch" is actionable.
      const detail = await upstream
        .json()
        .then((b: { message?: string }) => b.message)
        .catch(() => undefined);

      return NextResponse.json(
        { error: detail ?? "Floor refused the rerun" },
        { status: 409 },
      );
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Floor returned ${upstream.status}` },
        { status: 502 },
      );
    }

    const { started } = (await upstream.json()) as { started: string };

    return NextResponse.json({ started });
  } catch (err) {
    return serverError("assembly-line-rerun", err);
  }
}
