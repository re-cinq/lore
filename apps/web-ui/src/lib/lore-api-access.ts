import { NextResponse } from "next/server";
import {
  resolveLoreApiConfig,
  type LoreApiConfig,
} from "@/lib/lore-api-config";
import { sessionToken } from "@/lib/session-token";

/** The session gate then the upstream credentials every browser-facing lore-api proxy shares: a reader without a session, and a deployment with no lore-api configured, are refused the same way everywhere. */
export async function authorizeSessionLoreApi(): Promise<
  LoreApiConfig | NextResponse
> {
  if (!(await sessionToken())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return (
    (await resolveLoreApiConfig()) ??
    NextResponse.json({ error: "LORE_API_URL not configured" }, { status: 500 })
  );
}
