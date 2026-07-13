export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { serverError } from "@/lib/api-error";

interface Task {
  id: string;
  status: string;
  target_repo: string;
}

async function checkRepoAccess(
  accessToken: string,
  repo: string,
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });

    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const session = (await getServerSession(authOptions)) as {
      accessToken?: string;
    } | null;

    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const task = await queryOne<Task>(
      `SELECT id, status, target_repo FROM pipeline.tasks WHERE id = $1`,
      [id],
    );

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const hasAccess = await checkRepoAccess(
      session.accessToken,
      task.target_repo,
    );

    if (!hasAccess) {
      return NextResponse.json(
        { error: "Access denied — you do not have access to this repo" },
        { status: 403 },
      );
    }

    // Proxy to the MCP server's timeline endpoint. The MCP server
    // does the GitHub commit walk + trailer parsing.
    const apiUrl = process.env.LORE_API_URL;
    const apiToken = process.env.LORE_INGEST_TOKEN;

    if (!apiUrl || !apiToken) {
      return NextResponse.json(
        { error: "LORE_API_URL/LORE_INGEST_TOKEN not configured" },
        { status: 500 },
      );
    }

    const upstream = await fetch(
      `${apiUrl}/api/tasks/${encodeURIComponent(id)}/timeline`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );
    const body = await upstream.text();

    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return serverError("timeline", err);
  }
}
