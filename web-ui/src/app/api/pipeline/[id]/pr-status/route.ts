export const dynamic = "force-dynamic";
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

// Type definitions for PR status
type PRStatus =
  | 'draft'
  | 'open'
  | 'checks-failing'
  | 'changes-requested'
  | 'approved'
  | 'merged'
  | 'closed';

interface PRDetails {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  html_url: string;
  checks: Array<{ name: string; status: string; conclusion: string | null }>;
  reviews: Array<{ user: string; state: string; submitted_at: string }>;
  computed_status: PRStatus;
}

interface Task {
  target_repo: string;
  pr_number: number | null;
}

// GitHub API helper function
async function fetchPRDetails(repo: string, prNumber: number): Promise<PRDetails> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }

  const [owner, repoName] = repo.split('/');
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // First fetch PR details to get the head SHA
  const prResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}`, { headers });

  if (!prResponse.ok) {
    throw new Error(`GitHub API error: ${prResponse.status} ${prResponse.statusText}`);
  }

  const pr = await prResponse.json();

  // Now fetch checks and reviews in parallel using the head SHA
  const [checksResponse, reviewsResponse] = await Promise.allSettled([
    fetch(`https://api.github.com/repos/${owner}/${repoName}/commits/${pr.head.sha}/check-runs`, { headers }),
    fetch(`https://api.github.com/repos/${owner}/${repoName}/pulls/${prNumber}/reviews`, { headers }),
  ]);


  // Handle checks response (might fail if no checks exist)
  let checks: Array<{ name: string; status: string; conclusion: string | null }> = [];
  if (checksResponse.status === 'fulfilled' && checksResponse.value.ok) {
    const checksData = await checksResponse.value.json();
    checks = checksData.check_runs?.map((check: any) => ({
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
    })) || [];
  }

  // Handle reviews response
  let reviews: Array<{ user: string; state: string; submitted_at: string }> = [];
  if (reviewsResponse.status === 'fulfilled' && reviewsResponse.value.ok) {
    const reviewsData = await reviewsResponse.value.json();
    reviews = reviewsData.map((review: any) => ({
      user: review.user?.login || 'unknown',
      state: review.state,
      submitted_at: review.submitted_at || '',
    }));
  }

  // Compute status according to the spec logic
  let computed_status: PRStatus;
  if (pr.merged) {
    computed_status = 'merged';
  } else if (pr.state === 'closed') {
    computed_status = 'closed';
  } else if (pr.draft) {
    computed_status = 'draft';
  } else if (checks.some(check => check.conclusion === 'failure')) {
    computed_status = 'checks-failing';
  } else if (reviews.some(review => review.state === 'CHANGES_REQUESTED')) {
    computed_status = 'changes-requested';
  } else if (reviews.some(review => review.state === 'APPROVED') && checks.every(check => check.conclusion !== 'failure')) {
    computed_status = 'approved';
  } else {
    computed_status = 'open';
  }

  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft || false,
    merged: pr.merged || false,
    mergeable: pr.mergeable,
    html_url: pr.html_url,
    checks,
    reviews,
    computed_status,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get task details from database
    const task = await queryOne<Task>(
      'SELECT target_repo, pr_number FROM pipeline.tasks WHERE id = $1',
      [id]
    );

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    if (!task.pr_number || !task.target_repo) {
      return NextResponse.json(
        { error: 'Task does not have an associated PR' },
        { status: 400 }
      );
    }

    // Fetch PR details from GitHub
    const prDetails = await fetchPRDetails(task.target_repo, task.pr_number);

    return NextResponse.json(prDetails);
  } catch (error: any) {
    console.error('[pr-status] Error fetching PR status:', error);

    // Handle different error types
    if (error.message.includes('GITHUB_TOKEN')) {
      return NextResponse.json(
        { error: 'GitHub API configuration error' },
        { status: 500 }
      );
    }

    if (error.message.includes('GitHub API error')) {
      return NextResponse.json(
        { error: 'Failed to fetch PR from GitHub', details: error.message },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}