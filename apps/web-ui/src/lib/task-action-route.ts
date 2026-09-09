import { NextResponse } from "next/server";
import type { ApiResult } from "@/lib/api/result";
import { serverError, upstreamError } from "@/lib/api-error";

/** The externally visible origin from the ingress headers — `req.url` is the in-cluster address, which would bounce the reader off the public host. */
function requestOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";

  return host ? `${proto}://${host}` : req.url;
}

/** A task command route: lore-api owns the state rules, so this forwards its refusal and otherwise bounces back to the task page. */
export function taskActionRoute(
  command: (id: string) => Promise<ApiResult<unknown>>,
  actionLabel: string,
  errorContext: string,
) {
  return async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const { id } = await params;

    try {
      return await runTaskCommand(id, req, { command, actionLabel });
    } catch (err) {
      return serverError(errorContext, err);
    }
  };
}

/** lore-api's refusal is forwarded as-is; success bounces back to the task page the command acted on. */
async function runTaskCommand(
  id: string,
  req: Request,
  action: {
    command: (id: string) => Promise<ApiResult<unknown>>;
    actionLabel: string;
  },
): Promise<Response> {
  const result = await action.command(id);

  if (result.status !== "ok") {
    return upstreamError(action.actionLabel, result);
  }

  return NextResponse.redirect(new URL(`/tasks/${id}`, requestOrigin(req)));
}
