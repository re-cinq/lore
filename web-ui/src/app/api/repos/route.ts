export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    // Get onboarded repos
    const onboarded = await query(
      `SELECT full_name, onboarding_pr_merged, last_ingested_at FROM lore.repos ORDER BY onboarded_at DESC`
    );

    // Get repos from GitHub App installation
    // For now, return just the onboarded list + a few known repos
    // Full GitHub App API integration requires the private key which is only in the MCP server
    const available = [
      { full_name: 're-cinq/lore', onboarded: true },
      // More repos would come from the GitHub App installation API
    ];

    return NextResponse.json({ onboarded, available });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
