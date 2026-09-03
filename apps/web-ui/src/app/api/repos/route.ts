export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { listAllRepos } from "@/lib/api/repos";
import { serverError, upstreamError } from "@/lib/api-error";

export async function GET() {
  try {
    const repos = await listAllRepos();

    if (repos.status !== "ok") {
      return upstreamError("Repos", repos);
    }
    // lore-api already orders by onboarded_at DESC; this route only ever needed three of the columns it returns.
    const onboarded = repos.data.repos.map((repo) => ({
      full_name: repo.full_name,
      onboarding_pr_merged: repo.onboarding_pr_merged,
      last_ingested_at: repo.last_ingested_at,
    }));

    // Full GitHub App installation listing needs the private key, which only the MCP server holds.
    const available = [{ full_name: "re-cinq/lore", onboarded: true }];

    return NextResponse.json({ onboarded, available });
  } catch (err) {
    return serverError("repos", err);
  }
}
