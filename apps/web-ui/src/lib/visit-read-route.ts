// The session-authed proxy for one visit's reads (run-viz FR4.1i): the run's access ladder first, then lore-api, which itself refuses a visit that is not the run's.
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { serverError } from "@/lib/api-error";
import { proxyJson } from "@/lib/floor-proxy";

export type VisitRead = "model-calls" | "events";

export function visitReadRoute(read: VisitRead) {
  return async function GET(
    req: Request,
    { params }: { params: Promise<{ id: string; visitId: string }> },
  ) {
    const { id, visitId } = await params;

    try {
      return await proxyVisitRead({ req, id, visitId, read });
    } catch (err) {
      return serverError(`assembly-run-visit-${read}`, err);
    }
  };
}

async function proxyVisitRead(ask: {
  req: Request;
  id: string;
  visitId: string;
  read: VisitRead;
}): Promise<Response> {
  const auth = await authorizeAssemblyRunAccess(ask.id);

  if (isAssemblyRunAuthError(auth)) {
    return auth;
  }

  return proxyJson(
    await fetch(
      `${auth.upstreamUrl}/api/assembly-runs/${encodeURIComponent(ask.id)}/visits/${encodeURIComponent(ask.visitId)}/${ask.read}`,
      {
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: ask.req.signal,
      },
    ),
  );
}
