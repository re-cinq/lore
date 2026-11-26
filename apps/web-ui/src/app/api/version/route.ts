import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public build-version probe (`release` is the chart's image tag: vX.Y.Z on a release install, a short SHA on ours) — CI's smoke job asserts the live SHA matches the just-built image tag, and lore-api's GET /api/versions lists it with the planning packages baked in at build time.
export function GET() {
  return NextResponse.json({
    version: process.env.LORE_UI_VERSION ?? "dev",
    release: process.env.LORE_RELEASE ?? null,
    packages: JSON.parse(process.env.LORE_UI_PACKAGES || "{}") as Record<
      string,
      string
    >,
  });
}
