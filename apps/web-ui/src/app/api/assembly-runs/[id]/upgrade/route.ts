export const dynamic = "force-dynamic";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
  type AssemblyRunAuth,
} from "@/lib/assembly-run-auth";
import { serverError } from "@/lib/api-error";
import { proxyJson } from "@/lib/floor-proxy";

// "Upgrade assembly line" backend: authorizes against the run's repo, then asks lore-api to start the newest version of the run's line with the source run's inputs. It answers the floor's `{ run_id }`, or its refusal, as JSON and the button navigates: a redirect built here would carry this pod's own origin, which is nowhere the browser can go.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await upgrade((await params).id);
  } catch (err) {
    return serverError("assembly-run-upgrade", err);
  }
}

async function upgrade(runId: string): Promise<Response> {
  const auth = await authorizeAssemblyRunAccess(runId);

  return isAssemblyRunAuthError(auth)
    ? auth
    : proxyJson(await askLoreApi(auth));
}

function askLoreApi(auth: AssemblyRunAuth): Promise<Response> {
  return fetch(
    `${auth.upstreamUrl}/api/assembly-runs/${encodeURIComponent(auth.run.id)}/upgrade`,
    {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` },
    },
  );
}
