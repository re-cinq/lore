export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { redeemCode } from "@/lib/api/auth";
import { requestOrigin } from "@/lib/request-origin";
import { returnPathOf } from "@/lib/return-path";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session-cookie-options";
import { callbackAction } from "@/lib/sign-in-callback";

// Where lore-api sends the person back after GitHub: swaps the one-time code for the session token and keeps it in a cookie that lives as long as the token does.
export async function GET(req: Request) {
  const origin = requestOrigin(req.headers);
  const query = new URL(req.url).searchParams;
  const action = callbackAction(query);
  const next = returnPathOf(query.get("next"));

  if (action.action === "invalid") {
    return NextResponse.json(
      { error: "no sign-in to finish" },
      { status: 400 },
    );
  }

  if (action.action === "failed") {
    return NextResponse.redirect(errorPage(origin, action.reason, next));
  }

  return signedIn(action.code, origin, next);
}

/** The page the person asked for, with the session cookie set, or the error page when lore-api would not redeem the code. */
async function signedIn(
  code: string,
  origin: string,
  next: string,
): Promise<NextResponse> {
  const session = await redeemCode(code);

  if (session.status !== "ok") {
    return NextResponse.redirect(errorPage(origin, "state_expired", next));
  }
  const response = NextResponse.redirect(`${origin}${next}`);

  response.cookies.set(
    SESSION_COOKIE,
    session.data.token,
    sessionCookieOptions(new Date(session.data.expires_at), origin),
  );

  return response;
}

/** The error page, which keeps the requested page so its retry link can ask for it again. */
function errorPage(origin: string, reason: string, next: string): string {
  const retry = next === "/" ? "" : `&next=${encodeURIComponent(next)}`;

  return `${origin}/auth/error?reason=${reason}${retry}`;
}
