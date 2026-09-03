export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { loadFeaturePoll } from "@/lib/feature-poll";

// Thin on purpose: excluded from coverage, so the reads live in @/lib/feature-poll, under the gate.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ owner: string; repo: string; id: string }> },
) {
  const { owner, repo, id } = await params;
  const fullName = `${owner}/${repo}`;
  // Authorize BEFORE reading anything — a 404 must never be usable to probe feature ids in a repo the caller can't see.
  const session = (await getServerSession(authOptions)) as {
    accessToken?: string;
  } | null;

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await userCanAccessRepo(session.accessToken, fullName))) {
    return NextResponse.json(
      { error: "Access denied — you do not have access to this repo" },
      { status: 403 },
    );
  }
  // `?graph=<runId>` — the client already holds this run's immutable graph clone, so the server omits re-sending it every four seconds.
  const payload = await loadFeaturePoll(
    fullName,
    id,
    new URL(req.url).searchParams.get("graph"),
  );

  if (!payload) {
    return NextResponse.json({ error: "feature not found" }, { status: 404 });
  }

  return NextResponse.json(payload);
}
