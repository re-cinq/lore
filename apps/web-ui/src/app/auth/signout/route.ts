export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { endSession } from "@/lib/api/auth";
import { requestOrigin } from "@/lib/request-origin";
import { SESSION_COOKIE } from "@/lib/session-cookie-options";

// Ends the session at lore-api (its token stops working at once), then drops the cookie and returns to the sign-in page.
export async function POST(req: Request) {
  await endSession();
  const response = NextResponse.redirect(
    `${requestOrigin(req.headers)}/auth/signin`,
    {
      status: 303,
    },
  );

  response.cookies.delete(SESSION_COOKIE);

  return response;
}
