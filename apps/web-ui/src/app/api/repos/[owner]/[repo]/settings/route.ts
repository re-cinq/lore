export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getRepo } from "@/lib/api/repos";
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
    const { full_name, team, settings } = record.data;

    return NextResponse.json({ full_name, team, settings });
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

    // Verify the repo exists
    const record = await getRepo(fullName);

    if (record.status !== "ok") {
      return upstreamError("Settings", record);
    }
    const existing = record.data;

    // Build update fields
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (body.team !== undefined) {
      updates.push(`team = $${paramIdx++}`);
      values.push(body.team || null);
    }

    if (body.settings !== undefined) {
      // Merge into existing settings instead of overwriting
      updates.push(
        `settings = COALESCE(settings, '{}') || $${paramIdx++}::jsonb`,
      );
      values.push(JSON.stringify(body.settings));
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    values.push(fullName);
    await query(
      `UPDATE lore.repos SET ${updates.join(", ")} WHERE full_name = $${paramIdx}`,
      values,
    );

    // A changed team re-points the repo's chunk-schema resolution, stranding
    // any legacy org_shared rows. Signal the Floor (event shape mirrors the
    // canonical insertEvent in @re-cinq/lore-shared events.ts — web-ui does
    // not import the workspace lib) so it relocates them immediately; the
    // nightly reindex remains the safety net, so a failed insert degrades to
    // that instead of failing the settings write that already happened.
    if (body.team !== undefined && (body.team || null) !== existing.team) {
      try {
        await query(
          `INSERT INTO pipeline.events (event_name, source, params, repo)
           VALUES ('internal.repo.team_changed', 'internal', $1::jsonb, $2)`,
          [JSON.stringify({ repo: fullName }), fullName],
        );
      } catch (err) {
        console.error(
          `[settings] team_changed event insert failed for ${fullName} (nightly reindex will relocate):`,
          err,
        );
      }
    }

    const updated = await getRepo(fullName);

    if (updated.status !== "ok") {
      return upstreamError("Settings", updated);
    }

    return NextResponse.json({
      full_name: updated.data.full_name,
      team: updated.data.team,
      settings: updated.data.settings,
    });
  } catch (err) {
    return serverError("settings.POST", err);
  }
}
