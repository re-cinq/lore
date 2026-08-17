export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { loadFeaturePoll } from "@/lib/feature-poll";

// The planning wizard's poll. Thin on purpose: this file is excluded from
// coverage, so anything that lives here is untested by construction — the reads
// are in @/lib/feature-poll, under the gate.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ owner: string; repo: string; id: string }> },
) {
  const { owner, repo, id } = await params;
  const fullName = `${owner}/${repo}`;
  // Authorize BEFORE reading anything. The repo is in the path, so nothing has to
  // be looked up first — which also means a 404 cannot be used to probe which
  // feature ids exist in a repo the caller has no access to.
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
  // `?graph=<runId>` — the run whose immutable graph clone the client already
  // holds, so the server can omit it instead of re-sending it every four seconds.
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
