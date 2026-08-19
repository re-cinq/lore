export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { listRepos } from "@/lib/api/repos";
import { serverError, upstreamError } from "@/lib/api-error";

export async function GET() {
  try {
    const repos = await listRepos();

    if (repos.status !== "ok") {
      return upstreamError("Repos", repos);
    }
    // lore-api already orders by onboarded_at DESC; this route only ever needed
    // three of the columns it returns.
    const onboarded = repos.data.repos.map((repo) => ({
      full_name: repo.fullName,
      onboarding_pr_merged: repo.onboardingPrMerged,
      last_ingested_at: repo.lastIngestedAt,
    }));

    // Get repos from GitHub App installation
    // For now, return just the onboarded list + a few known repos
    // Full GitHub App API integration requires the private key which is only in the MCP server
    const available = [
      { full_name: "re-cinq/lore", onboarded: true },
      // More repos would come from the GitHub App installation API
    ];

    return NextResponse.json({ onboarded, available });
  } catch (err) {
    return serverError("repos", err);
  }
}
