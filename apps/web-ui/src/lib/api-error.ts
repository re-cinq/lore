import { NextResponse } from "next/server";

/**
 * Logs the full error (stack included) to the server console and returns a 500
 * JSON response carrying just the message. Centralizes 500 handling for API
 * route handlers so every unexpected throw is debuggable in the terminal — the
 * `context` tag identifies which route logged it.
 */
export function serverError(context: string, err: unknown): NextResponse {
  console.error(`[api:${context}]`, err);
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: 500 });
}
