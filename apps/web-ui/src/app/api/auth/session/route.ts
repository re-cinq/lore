export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getMe } from "@/lib/api/auth";
import { sessionAnswer } from "./session-answer";

// What an open tab asks to learn whether its session still stands. Under /api/auth, which the middleware lets through without a cookie, so an ended session gets an answer here and not a redirect to the sign-in page.
export async function GET() {
  const { status, body } = sessionAnswer(await getMe());

  return NextResponse.json(body, { status });
}
