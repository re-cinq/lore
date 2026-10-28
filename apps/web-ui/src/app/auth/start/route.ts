export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { loreApiPublicUrl } from "@/lib/lore-api-public-url";
import { requestOrigin } from "@/lib/request-origin";
import { returnPathOf } from "@/lib/return-path";

// Where the sign-in button leads: lore-api begins the GitHub sign-in, told which page of this UI to come back to (ADR-053).
export function GET(req: Request) {
  const apiUrl = loreApiPublicUrl(process.env);

  if (!apiUrl) {
    return NextResponse.json(
      { error: "LORE_API_URL not configured" },
      { status: 500 },
    );
  }
  const next = returnPathOf(new URL(req.url).searchParams.get("next"));
  const back = `${requestOrigin(req.headers)}/auth/callback${callbackQuery(next)}`;

  return NextResponse.redirect(
    `${apiUrl}/api/auth/login?return=${encodeURIComponent(back)}`,
  );
}

/** The page to land on after the sign-in rides along on the return address; home needs no mention. */
function callbackQuery(next: string): string {
  return next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
}
