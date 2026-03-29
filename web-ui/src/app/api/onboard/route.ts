export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { full_name } = await request.json();
    if (!full_name?.includes('/')) {
      return NextResponse.json({ error: 'Invalid repo format' }, { status: 400 });
    }

    const [owner, name] = full_name.split('/');

    // Insert into repos table
    const result = await query(
      `INSERT INTO lore.repos (owner, name, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (full_name) DO UPDATE SET onboarded_at = now()
       RETURNING id, full_name`,
      [owner, name, full_name]
    );

    return NextResponse.json({ repo: result[0], message: 'Repo onboarded' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
