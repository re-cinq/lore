export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  try {
    const { owner, repo } = await params;
    const fullName = `${owner}/${repo}`;
    const repoData = await queryOne(
      `SELECT full_name, team, settings FROM lore.repos WHERE full_name = $1`,
      [fullName]
    );
    if (!repoData) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 });
    }
    return NextResponse.json(repoData);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  try {
    const { owner, repo } = await params;
    const fullName = `${owner}/${repo}`;
    const body = await request.json();

    // Verify the repo exists
    const existing = await queryOne(
      `SELECT full_name FROM lore.repos WHERE full_name = $1`,
      [fullName]
    );
    if (!existing) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 });
    }

    // Build update fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (body.team !== undefined) {
      updates.push(`team = $${paramIdx++}`);
      values.push(body.team || null);
    }

    if (body.settings !== undefined) {
      updates.push(`settings = $${paramIdx++}`);
      values.push(JSON.stringify(body.settings));
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(fullName);
    await query(
      `UPDATE lore.repos SET ${updates.join(', ')} WHERE full_name = $${paramIdx}`,
      values
    );

    const updated = await queryOne(
      `SELECT full_name, team, settings FROM lore.repos WHERE full_name = $1`,
      [fullName]
    );

    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
