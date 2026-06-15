export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getRepoFileContent } from '@/lib/github';
import { serverError } from '@/lib/api-error';

const MAX_LINES = 60;
const DEFAULT_WINDOW = 24;

/** Returns a line slice of a repo file as plain text — powers the TestChunk code preview. */
export async function GET(req: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'required: path query param' }, { status: 400 });
  }
  const start = Math.max(1, Number(url.searchParams.get('start')) || 1);
  const requestedEnd = Number(url.searchParams.get('end')) || start + DEFAULT_WINDOW;
  const end = Math.min(start + MAX_LINES - 1, requestedEnd);
  try {
    const content = await getRepoFileContent(`${owner}/${repo}`, path);
    if (content === null) {
      return NextResponse.json({ error: 'file unavailable' }, { status: 404 });
    }
    const slice = content.split('\n').slice(start - 1, end).join('\n');
    return NextResponse.json({ path, start, end, text: slice });
  } catch (err) {
    return serverError('file', err);
  }
}
