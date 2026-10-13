export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/session-access-token";
import { authorizeRepoUpstreamAccess } from "@/lib/floor-access";
import { serverError } from "@/lib/api-error";

const API = "lore-api";

interface TriggerAuth {
  repo: string;
  prNumber: number;
  upstreamUrl: string;
  token: string;
}

// "Trigger review" backend: authorizes against the target repo, then asks lore-api to start the review on the floor (UI has no write path for assembly lines of its own).
export async function POST(req: Request) {
  try {
    const auth = await authorizeTrigger(req);

    if (auth instanceof Response) {
      return auth;
    }

    const refusal = await startReview(auth);

    if (refusal) {
      return refusal;
    }

    return buildTriggerRedirect(req);
  } catch (err) {
    return serverError("review-trigger", err);
  }
}

/** Session → form → repo-access → lore-api-env ladder for the trigger request. */
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

  const { repo } = trigger;
  const upstream = await authorizeRepoUpstreamAccess(accessToken, repo, API);

  return upstream instanceof NextResponse
    ? upstream
    : { ...trigger, ...upstream };
}

/** Asks lore-api to start the review, and answers with the 502 if it would not — null means it did. */
async function startReview(auth: TriggerAuth): Promise<NextResponse | null> {
  const { repo, prNumber, upstreamUrl, token } = auth;
  const upstream = await fetch(`${upstreamUrl}/api/review/start`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ repo, pr_number: prNumber }),
  });

  if (upstream.ok) {
    return null;
  }

  return NextResponse.json(
    { error: `lore-api returned ${upstream.status}` },
    { status: 502 },
  );
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
