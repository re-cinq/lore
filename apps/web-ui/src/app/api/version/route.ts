import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public build-version probe — CI's smoke job asserts the live SHA matches the just-built image tag.
export function GET() {
  return NextResponse.json({ version: process.env.LORE_UI_VERSION ?? "dev" });
}
