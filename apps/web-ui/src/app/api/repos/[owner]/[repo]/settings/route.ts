export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getRepo, putRepoSettings } from "@/lib/api/repos";
import { serverError, upstreamError } from "@/lib/api-error";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const { owner, repo } = await params;
    const fullName = `${owner}/${repo}`;
    const record = await getRepo(fullName);

    if (record.status !== "ok") {
      return upstreamError("Settings", record);
    }
    const { team, settings } = record.data;

    return NextResponse.json({ full_name: fullName, team, settings });
  } catch (err) {
    return serverError("settings.GET", err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const { owner, repo } = await params;
    const fullName = `${owner}/${repo}`;
    const body = await request.json();

    // lore-api owns the write incl. the privileged-field refusal; a 403 means the caller hit a dark-factory field needing the CODEOWNER approval PR.
    return await writeSettings(fullName, buildSettingsPatch(body));
  } catch (err) {
    return serverError("settings.POST", err);
  }
}

/** The write, then the read-back that answers with what is now stored. Either upstream refusal is passed on as-is. */
async function writeSettings(
  fullName: string,
  patch: ReturnType<typeof buildSettingsPatch>,
) {
  const written = await putRepoSettings(fullName, patch);

  if (written.status !== "ok") {
    return upstreamError("Settings", written);
  }

  const updated = await getRepo(fullName);

  if (updated.status !== "ok") {
    return upstreamError("Settings", updated);
  }
  const { full_name, team, settings } = updated.data;

  return NextResponse.json({ full_name, team, settings });
}

function buildSettingsPatch(body: {
  team?: string | null;
  settings?: Record<string, unknown>;
}): { team?: string | null; settings?: Record<string, unknown> } {
  return {
    ...(body.team !== undefined ? { team: body.team || null } : {}),
    ...(body.settings !== undefined ? { settings: body.settings } : {}),
  };
}
