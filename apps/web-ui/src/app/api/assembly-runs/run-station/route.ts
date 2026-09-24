export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { resolveSessionAccessToken } from "@/lib/session-access-token";
import { resolveLoreApiConfig } from "@/lib/lore-api-config";
import { serverError } from "@/lib/api-error";
import {
  readAuthorizedSourceRun,
  unconfigured,
  upstreamRefusal,
} from "@/lib/run-proxy";
import { getSession } from "@/lib/session";
import { planUserOf, type PlanSession } from "@/lib/plan-user";

// "Run this station" backend (specs/fork-rerun-from-node FR8): resolves the run's repo server-side, authorizes, then asks lore-api to run the station as its next iteration in that run.
export async function POST(req: Request) {
  try {
    const accessToken = await resolveSessionAccessToken();

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ask = await readForm(req);

    return ask instanceof Response ? ask : await startStation(accessToken, ask);
  } catch (err) {
    return serverError("assembly-run-run-station", err);
  }
}

interface StationAsk {
  runId: string;
  nodeId: string;
}

async function readForm(req: Request): Promise<StationAsk | NextResponse> {
  const form = await req.formData();
  const runId = String(form.get("run_id") ?? "");
  const nodeId = String(form.get("node_id") ?? "");

  return runId && nodeId
    ? { runId, nodeId }
    : NextResponse.json(
        { error: "run_id and node_id are required" },
        { status: 400 },
      );
}

async function startStation(
  accessToken: string,
  { runId, nodeId }: StationAsk,
) {
  const apiConfig = resolveLoreApiConfig();

  if (!apiConfig) {
    return unconfigured();
  }
  const { apiUrl } = apiConfig;
  const headers = { Authorization: `Bearer ${apiConfig.token}` };
  const line = await readAuthorizedSourceRun(
    apiUrl,
    headers,
    accessToken,
    runId,
  );

  return line instanceof Response
    ? line
    : runAnswer(await postRunStation(apiUrl, headers, runId, nodeId));
}

// JSON, not a redirect — the button's fetch reloads the page itself.
async function runAnswer(upstream: Response): Promise<NextResponse> {
  return upstream.ok
    ? NextResponse.json({ id: ((await upstream.json()) as { id: string }).id })
    : upstreamRefusal(upstream);
}

async function postRunStation(
  apiUrl: string,
  headers: Record<string, string>,
  runId: string,
  nodeId: string,
): Promise<Response> {
  return fetch(
    `${apiUrl}/api/assembly-runs/${encodeURIComponent(runId)}/run-station`,
    {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: nodeId, actor: await actorName() }),
    },
  );
}

// The person is named on the visit they ran; a session with no login falls back to its display name.
async function actorName(): Promise<string> {
  const user = planUserOf((await getSession()) as PlanSession | null);

  return user?.id ?? "someone";
}
