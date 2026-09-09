import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import {
  resolveLoreApiConfig,
  type LoreApiConfig,
} from "@/lib/lore-api-config";

/** The session gate then the upstream credentials every browser-facing lore-api proxy shares: a reader without a session, and a deployment with no lore-api configured, are refused the same way everywhere. */
export async function authorizeSessionLoreApi(): Promise<
  LoreApiConfig | NextResponse
> {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiConfig = resolveLoreApiConfig();

  if (!apiConfig) {
    return NextResponse.json(
      { error: "LORE_API_URL/LORE_INGEST_TOKEN not configured" },
      { status: 500 },
    );
  }

  return apiConfig;
}
