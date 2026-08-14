export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getTask } from "@/lib/api/tasks";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { serverError, upstreamError } from "@/lib/api-error";
import { Storage } from "@google-cloud/storage";

const BUCKET = process.env.LORE_LOG_BUCKET || "lore-task-logs";

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
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    // Auth check
    const session = (await getServerSession(authOptions)) as {
      accessToken?: string;
    } | null;

    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await getTask(id);

    if (result.status !== "ok") {
      return upstreamError("Logs", result);
    }
    const task = result.data;

    // Repo access check
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

    // Read from GCS
    const storage = new Storage();
    const file = storage
      .bucket(BUCKET)
      .file(`${task.target_repo}/${task.id}/output.log`);

    const [exists] = await file.exists();

    if (!exists) {
      return NextResponse.json({
        logs: null,
        status: task.status,
        totalSize: 0,
      });
    }

    if (offset > 0) {
      const [metadata] = await file.getMetadata();
      const totalSize = Number(metadata.size || 0);

      if (offset >= totalSize) {
        return NextResponse.json({ logs: "", status: task.status, totalSize });
      }
      const [content] = await file.download({
        start: offset,
        end: totalSize - 1,
      });

      return NextResponse.json({
        logs: content.toString("utf-8"),
        status: task.status,
        totalSize,
      });
    }

    const [content] = await file.download();

    return NextResponse.json({
      logs: content.toString("utf-8"),
      status: task.status,
      totalSize: content.length,
    });
  } catch (err) {
    return serverError("logs", err);
  }
}
