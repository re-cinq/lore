export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import {
  authorizeAssemblyRunAccess,
  isAssemblyRunAuthError,
} from "@/lib/assembly-run-auth";
import { serverError } from "@/lib/api-error";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorizeAssemblyRunAccess((await params).id);
    if (isAssemblyRunAuthError(auth)) return auth;
    const response = await fetch(
      `${auth.upstreamUrl}/api/assembly-runs/${encodeURIComponent(auth.run.id)}/upgrade`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      return NextResponse.json(
        { error: `lore-api returned ${response.status}` },
        { status: response.status },
      );
    const body = (await response.json()) as { run_id: string };
    return NextResponse.redirect(
      new URL(`/assembly-runs/${encodeURIComponent(body.run_id)}`, req.url),
      { status: 303 },
    );
  } catch (err) {
    return serverError("assembly-run-upgrade", err);
  }
}
