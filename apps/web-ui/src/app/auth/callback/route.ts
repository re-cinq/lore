export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { redeemCode } from "@/lib/api/auth";
import { requestOrigin } from "@/lib/request-origin";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session-cookie-options";
import { callbackAction } from "@/lib/sign-in-callback";

// Where lore-api sends the person back after GitHub: swaps the one-time code for the session token and keeps it in a cookie that lives as long as the token does.
export async function GET(req: Request) {
  const origin = requestOrigin(req.headers);
  const action = callbackAction(new URL(req.url).searchParams);

  if (action.action === "invalid") {
    return NextResponse.json(
      { error: "no sign-in to finish" },
      { status: 400 },
    );
  }

  if (action.action === "failed") {
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${action.reason}`,
    );
  }
  const session = await redeemCode(action.code);

  if (session.status !== "ok") {
    return NextResponse.redirect(`${origin}/auth/error?reason=state_expired`);
  }
  const response = NextResponse.redirect(`${origin}/`);

  response.cookies.set(
    SESSION_COOKIE,
    session.data.token,
    sessionCookieOptions(
      new Date(session.data.expires_at),
      origin.startsWith("https:"),
    ),
  );

  return response;
}
