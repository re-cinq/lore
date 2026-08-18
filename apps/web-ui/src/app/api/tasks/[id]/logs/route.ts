export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getTask } from "@/lib/api/tasks";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { serverError, upstreamError } from "@/lib/api-error";
import { userCanAccessRepo } from "@/lib/user-repo-access";

/**
 * GET /api/tasks/[id]/logs — session-authed proxy for a task's stored agent
 * turns, forwarding to the Floor's /api/agent-turns/task/{taskId}
 * (specs/turn-level-transcript-store FR4, #1292). Replaces the old GCS
 * `output.log` read: cluster pods stopped writing that object when the
 * agent-events ingest landed, so the bucket path served nothing for any
 * cluster-run task.
 *
 * The auth ladder mirrors the run-page turns proxy — session (401) → task
 * lookup (upstream code preserved) → repo access (403) — and the body is the
 * Floor's, byte for byte. The one addition: the task's recorded status rides
 * the X-Task-Status header, because the viewer's badge and poll gate need it
 * and the turn rows do not carry it.
 */
export async function GET(
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

    const result = await getTask(id);

    if (result.status !== "ok") {
      return upstreamError("Logs", result);
    }
    const task = result.data;

    if (!(await userCanAccessRepo(session.accessToken, task.target_repo))) {
      return NextResponse.json(
        { error: "Access denied — you do not have access to this repo" },
        { status: 403 },
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

    const incoming = new URL(req.url).searchParams;
    const forwarded = new URLSearchParams();

    for (const key of ["after", "limit"]) {
      const value = incoming.get(key);

      if (value !== null) {
        forwarded.set(key, value);
      }
    }

    const query = forwarded.size === 0 ? "" : `?${forwarded}`;
    const upstream = await fetch(
      `${floorUrl}/api/agent-turns/task/${encodeURIComponent(id)}${query}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: req.signal },
    );
    const body = await upstream.text();
    // The Floor's own auth answers (a rotated/mismatched ingest token) must
    // not masquerade as this proxy's session (401) / repo-access (403) ladder
    // — the viewer would tell every signed-in user to sign in.
    const status =
      upstream.status === 401 || upstream.status === 403
        ? 502
        : upstream.status;

    return new NextResponse(body, {
      status,
      headers: {
        "Content-Type": "application/json",
        "X-Task-Status": task.status,
      },
    });
  } catch (err) {
    return serverError("logs", err);
  }
}
