import { NextResponse } from "next/server";
import type { AssemblyRun } from "@/lib/assembly-runs";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { serverError } from "@/lib/api-error";
import type { UpstreamConfig } from "@/lib/floor-config";
import { proxyJson } from "@/lib/floor-proxy";
import { planUserOf, type PlanSession } from "@/lib/plan-user";
import { getSession } from "@/lib/session";

/** Where on lore-api the action is asked, from the run the ladder resolved and the route's own params. */
type ActionPathOf<P> = (run: AssemblyRun, params: P) => string;

/** A run action a person takes from the run page: climbs the session → run → repo-access ladder, then POSTs `{ requested_by }` with the signed-in person's GitHub login to lore-api and passes its answer or refusal through as JSON. */
export function personRunActionRoute<P extends { id: string }>(
  errorContext: string,
  pathOf: ActionPathOf<P>,
) {
  return async function POST(
    _req: Request,
    { params }: { params: Promise<P> },
  ) {
    try {
      return await askAsPerson(await params, pathOf);
    } catch (err) {
      return serverError(errorContext, err);
    }
  };
}

async function askAsPerson<P extends { id: string }>(
  params: P,
  pathOf: ActionPathOf<P>,
): Promise<Response> {
  const auth = await authorizeAssemblyRunAccess(params.id);

  if (isAssemblyRunAuthError(auth)) {
    return auth;
  }
  const user = planUserOf((await getSession()) as PlanSession | null);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return proxyJson(await postAs(auth, pathOf(auth.run, params), user.id));
}

function postAs(
  auth: UpstreamConfig,
  path: string,
  requestedBy: string,
): Promise<Response> {
  return fetch(`${auth.upstreamUrl}${path}`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requested_by: requestedBy }),
  });
}
