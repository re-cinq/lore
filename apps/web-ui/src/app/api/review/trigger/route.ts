export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { resolveSessionAccessToken } from "@/lib/session-access-token";
import { resolveFloorConfig } from "@/lib/floor-config";
import { serverError } from "@/lib/api-error";

/** The form's repo + PR number, or the 400 explaining what is missing. */
async function readTriggerForm(
  req: Request,
): Promise<{ repo: string; prNumber: number } | NextResponse> {
  const form = await req.formData();
  const repo = String(form.get("repo") ?? "");
  const prNumber = Number(form.get("pr_number"));

  if (!repo || !prNumber) {
    return NextResponse.json(
      { error: "repo and pr_number are required" },
      { status: 400 },
    );
  }

  return { repo, prNumber };
}

interface TriggerAuth {
  repo: string;
  prNumber: number;
  floorUrl: string;
  token: string;
}

/** Session → form → repo-access → Floor-env ladder for the trigger request. */
async function authorizeTrigger(
  req: Request,
): Promise<TriggerAuth | NextResponse> {
  const accessToken = await resolveSessionAccessToken();

  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const trigger = await readTriggerForm(req);

  if (trigger instanceof Response) {
    return trigger;
  }

  if (!(await userCanAccessRepo(accessToken, trigger.repo))) {
    return NextResponse.json(
      { error: "Access denied — you do not have access to this repo" },
      { status: 403 },
    );
  }

  const floorConfig = resolveFloorConfig();

  if (!floorConfig) {
    return NextResponse.json(
      { error: "LORE_FLOOR_URL/LORE_INGEST_TOKEN not configured" },
      { status: 500 },
    );
  }

  return { ...trigger, ...floorConfig };
}

/** Redirects back to the referring page (or the runs list, absent one) after a successful trigger. */
function buildTriggerRedirect(req: Request): NextResponse {
  const referer = req.headers.get("referer");
  const base = referer ?? new URL(req.url).origin;

  return NextResponse.redirect(
    new URL(referer ? base : "/assembly-runs", base),
    { status: 303 },
  );
}

// "Trigger review" backend: authorizes against the target repo, then proxies to the Floor's /api/review/start (UI has no cluster/DB write path for assembly lines).
export async function POST(req: Request) {
  try {
    const auth = await authorizeTrigger(req);

    if (auth instanceof Response) {
      return auth;
    }

    const { repo, prNumber, floorUrl, token } = auth;
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

    return buildTriggerRedirect(req);
  } catch (err) {
    return serverError("review-trigger", err);
  }
}
