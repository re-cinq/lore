import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public build-version probe — CI's smoke job asserts the live SHA matches the just-built image tag, and lore-api's GET /api/versions lists it with the planning packages baked in at build time.
export function GET() {
  return NextResponse.json({
    version: process.env.LORE_UI_VERSION ?? "dev",
    packages: JSON.parse(process.env.LORE_UI_PACKAGES || "{}") as Record<
      string,
      string
    >,
  });
}
