import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Public, unauthenticated build-version probe (see middleware matcher). The CI
// smoke job curls this and asserts the live SHA equals the just-built image tag,
// so a green deploy provably means "this commit is serving traffic".
export function GET() {
  return NextResponse.json({ version: process.env.LORE_UI_VERSION ?? 'dev' });
}
