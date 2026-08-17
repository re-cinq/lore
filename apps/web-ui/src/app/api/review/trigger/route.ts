export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

/**
 * POST /api/review/trigger — the "Trigger review" button's backend. Authorizes
 * the user against the target repo, then proxies to the Floor's
 * /api/review/start (the UI has no cluster/DB write path for assembly lines).
 * Body is the button's form fields (repo, pr_number). Redirects back to the
 * referring page on success.
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
    const repo = String(form.get("repo") ?? "");
    const prNumber = Number(form.get("pr_number"));

    if (!repo || !prNumber) {
      return NextResponse.json(
        { error: "repo and pr_number are required" },
        { status: 400 },
      );
    }

    if (!(await userCanAccessRepo(session.accessToken, repo))) {
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

    const upstream = await fetch(`${floorUrl}/api/review/start`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repo, pr_number: prNumber }),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Floor returned ${upstream.status}` },
        { status: 502 },
      );
    }

    const referer = req.headers.get("referer");
    const base = referer ?? new URL(req.url).origin;

    return NextResponse.redirect(
      new URL(referer ? base : "/assembly-runs", base),
      {
        status: 303,
      },
    );
  } catch (err) {
    return serverError("review-trigger", err);
  }
}
