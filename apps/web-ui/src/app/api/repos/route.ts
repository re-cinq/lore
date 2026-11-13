export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import {
  listAllRepos,
  listAvailableRepos,
  type RepoWithCounts,
} from "@/lib/api/repos";
import { serverError, upstreamError } from "@/lib/api-error";

export async function GET() {
  try {
    const repos = await listAllRepos();

    if (repos.status !== "ok") {
      return upstreamError("Repos", repos);
    }
    const available = await listAvailableRepos();

    if (available.status !== "ok") {
      return upstreamError("Available repos", available);
    }
    const { repos: repoRows } = repos.data;

    return NextResponse.json({
      onboarded: repoRows.map(toRow),
      available: available.data,
    });
  } catch (err) {
    return serverError("repos", err);
  }
}

function toRow(repo: RepoWithCounts) {
  return {
    full_name: repo.full_name,
    onboarding_pr_merged: repo.onboarding_pr_merged,
    last_ingested_at: repo.last_ingested_at,
  };
}
