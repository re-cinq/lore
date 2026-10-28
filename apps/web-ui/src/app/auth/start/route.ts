export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { loreApiPublicUrl } from "@/lib/lore-api-public-url";
import { requestOrigin } from "@/lib/request-origin";

// Where the sign-in button leads: lore-api begins the GitHub sign-in, told which page of this UI to come back to (ADR-053).
export function GET(req: Request) {
  const apiUrl = loreApiPublicUrl(process.env);

  if (!apiUrl) {
    return NextResponse.json(
      { error: "LORE_API_URL not configured" },
      { status: 500 },
    );
  }
  const back = `${requestOrigin(req.headers)}/auth/callback`;

  return NextResponse.redirect(
    `${apiUrl}/api/auth/login?return=${encodeURIComponent(back)}`,
  );
}
