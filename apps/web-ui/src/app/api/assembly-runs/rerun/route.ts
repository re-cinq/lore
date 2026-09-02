export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

/**
 * POST /api/assembly-runs/rerun — the "Retry from this node" button's backend
 * (specs/fork-rerun-from-node). Reads the source run from lore-api to learn its
 * repo and blueprint (the client is trusted with ids, never with authz facts),
 * authorizes the user against that repo, then starts the fork via lore-api's
 * POST /api/assembly-runs with `resume_from` and returns the new run's id —
 * the button navigates. Body is the button's form fields (run_id, node_id,
 * iteration).
 */
export async function POST(req: Request) {
  try {
    const session = (await getServerSession(authOptions)) as {
      accessToken?: string;
    } | null;

    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const runId = String(form.get("run_id") ?? "");
    const nodeId = String(form.get("node_id") ?? "");
    const iterationField = form.get("iteration");
    const iteration =
      iterationField === null ? undefined : Number(iterationField);

    if (!runId || !nodeId) {
      return NextResponse.json(
        { error: "run_id and node_id are required" },
        { status: 400 },
      );
    }

    if (
      iteration !== undefined &&
      (!Number.isInteger(iteration) || iteration < 1)
    ) {
      return NextResponse.json(
        { error: "iteration must be a positive integer" },
        { status: 400 },
      );
    }

    const apiUrl = process.env.LORE_API_URL;
    const token = process.env.LORE_INGEST_TOKEN;

    if (!apiUrl || !token) {
      return NextResponse.json(
        { error: "LORE_API_URL/LORE_INGEST_TOKEN not configured" },
        { status: 500 },
      );
    }

    const headers = { Authorization: `Bearer ${token}` };
    const runRes = await fetch(
      `${apiUrl}/api/assembly-runs/${encodeURIComponent(runId)}`,
      { signal: AbortSignal.timeout(30_000), headers },
    );

    if (!runRes.ok) {
      return NextResponse.json(
        { error: `assembly run not found (${runRes.status})` },
        { status: runRes.status === 404 ? 404 : 502 },
      );
    }

    const { line } = (await runRes.json()) as {
      line: { repo: string; blueprintName: string };
    };

    if (!(await userCanAccessRepo(session.accessToken, line.repo))) {
      return NextResponse.json(
        { error: "Access denied — you do not have access to this repo" },
        { status: 403 },
      );
    }

    const upstream = await fetch(`${apiUrl}/api/assembly-runs`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        definition: line.blueprintName,
        repo: line.repo,
        resume_from: {
          run_id: runId,
          node_id: nodeId,
          ...(iteration === undefined ? {} : { iteration }),
        },
      }),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `lore-api returned ${upstream.status}` },
        { status: 502 },
      );
    }

    const { id } = (await upstream.json()) as { id: string };

    // JSON, not a redirect: the caller is the retry button's fetch, and it
    // navigates to the new run itself — a 303 would make fetch swallow the
    // run page as an opaque followed response.
    return NextResponse.json({ id });
  } catch (err) {
    return serverError("assembly-run-rerun", err);
  }
}
