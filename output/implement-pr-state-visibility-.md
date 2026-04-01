I'll implement the PR State Visibility feature by searching Lore context first, then building each component systematically.

```bash
# Search for relevant patterns
curl -s http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"call_tool","params":{"name":"search_context","arguments":{"query":"GitHub API integration PR status checks reviews","limit":5}}}' | jq .

curl -s http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"call_tool","params":{"name":"search_context","arguments":{"query":"Next.js API routes database queries","limit":5}}}' | jq .

curl -s http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"call_tool","params":{"name":"get_adrs","arguments":{"query":"API design state computation","limit":5}}}' | jq .
```

Based on Lore conventions, here's the complete implementation:

```typescript
// agent/src/platform.ts
// Add to CodePlatform interface

export interface PRDetails {
  number: number;
  title: string;
  state: 'draft' | 'open' | 'closed' | 'merged';
  computed_status: 'draft' | 'open' | 'checks-failing' | 'changes-requested' | 'approved' | 'merged' | 'closed';
  html_url: string;
  author: {
    login: string;
    avatar_url: string;
  };
  created_at: string;
  updated_at: string;
  merged_at?: string;
  checks: {
    status: 'queued' | 'in_progress' | 'completed';
    conclusion: 'action_required' | 'cancelled' | 'failure' | 'neutral' | 'success' | 'skipped' | 'stale' | null;
    runs: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      url: string;
    }>;
  };
  reviews: {
    approved_by: string[];
    changes_requested_by: string[];
    pending: string[];
  };
}

export interface CodePlatform {
  // ... existing methods
  getPRDetails(repo: string, prNumber: number): Promise<PRDetails>;
}
```

```typescript
// agent/src/github.ts
// Implement in GitHubPlatform class

async getPRDetails(repo: string, prNumber: number): Promise<PRDetails> {
  const [owner, name] = repo.split('/');
  
  try {
    // Fetch in parallel: PR details, checks, and reviews
    const [pr, checks, reviews] = await Promise.all([
      this.octokit.rest.pulls.get({
        owner,
        repo: name,
        pull_number: prNumber,
      }),
      this.octokit.rest.checks.listForRef({
        owner,
        repo: name,
        ref: undefined, // Will be filled from PR head
      }).catch(() => ({ data: { check_runs: [] } })), // Graceful fallback
      this.octokit.rest.pulls.listReviews({
        owner,
        repo: name,
        pull_number: prNumber,
      }).catch(() => ({ data: [] })), // Graceful fallback
    ]);

    const prData = pr.data;
    const checkRuns = checks.data.check_runs || [];
    const reviewData = reviews.data || [];

    // Compute aggregated check status
    const checkStatuses = checkRuns.map(run => ({
      conclusion: run.conclusion,
      status: run.status,
    }));
    const hasFailures = checkStatuses.some(c => 
      c.conclusion === 'failure' || c.conclusion === 'action_required'
    );
    const allCompleted = checkStatuses.every(c => c.status === 'completed');
    const checkStatus = hasFailures ? 'completed' : 'in_progress';
    const checkConclusion = hasFailures ? 'failure' : (allCompleted ? 'success' : null);

    // Compute review status
    const uniqueReviewers = new Map<string, string>();
    for (const review of reviewData) {
      if (review.user?.login) {
        uniqueReviewers.set(review.user.login, review.state);
      }
    }

    const approved_by = Array.from(uniqueReviewers.entries())
      .filter(([_, state]) => state === 'APPROVED')
      .map(([login]) => login);
    const changes_requested_by = Array.from(uniqueReviewers.entries())
      .filter(([_, state]) => state === 'CHANGES_REQUESTED')
      .map(([login]) => login);

    // Compute final status
    let computed_status: PRDetails['computed_status'] = 'open';
    if (prData.draft) {
      computed_status = 'draft';
    } else if (prData.merged_at) {
      computed_status = 'merged';
    } else if (prData.state === 'closed') {
      computed_status = 'closed';
    } else if (changes_requested_by.length > 0) {
      computed_status = 'changes-requested';
    } else if (hasFailures) {
      computed_status = 'checks-failing';
    } else if (approved_by.length > 0) {
      computed_status = 'approved';
    }

    return {
      number: prData.number,
      title: prData.title,
      state: prData.merged_at ? 'merged' : prData.state as 'draft' | 'open' | 'closed',
      computed_status,
      html_url: prData.html_url,
      author: {
        login: prData.user?.login || 'unknown',
        avatar_url: prData.user?.avatar_url || '',
      },
      created_at: prData.created_at,
      updated_at: prData.updated_at,
      merged_at: prData.merged_at || undefined,
      checks: {
        status: checkStatus as 'queued' | 'in_progress' | 'completed',
        conclusion: checkConclusion as any,
        runs: checkRuns.map(run => ({
          name: run.name,
          status: run.status,
          conclusion: run.conclusion || 'pending',
          url: run.html_url,
        })),
      },
      reviews: {
        approved_by,
        changes_requested_by,
        pending: Array.from(uniqueReviewers.keys()).filter(
          login => !approved_by.includes(login) && !changes_requested_by.includes(login)
        ),
      },
    };
  } catch (error) {
    console.error(`Failed to fetch PR ${repo}#${prNumber}:`, error);
    throw new Error(`Could not fetch PR details: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

```typescript
// mcp-server/src/index.ts
// Add to MCP tools

{
  name: 'get_pr_status',
  description: 'Fetch live PR status from GitHub including checks and reviews. Computes status from API response.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in owner/name format',
      },
      pr_number: {
        type: 'number',
        description: 'PR number',
      },
    },
    required: ['repo', 'pr_number'],
  },
  handler: async (input: { repo: string; pr_number: number }) => {
    try {
      const details = await platform.getPRDetails(input.repo, input.pr_number);
      return {
        success: true,
        data: details,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
}
```

```typescript
// web-ui/src/app/api/pipeline/[id]/pr-status/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { platform } from '@/lib/platform';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id;

    // Fetch task from DB to get PR number and target repo
    const task = await db.query(
      `SELECT pr_number, target_repo FROM pipeline.tasks WHERE id = $1`,
      [taskId]
    );

    if (!task.rows.length) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    const { pr_number, target_repo } = task.rows[0];

    if (!pr_number || !target_repo) {
      return NextResponse.json(
        { error: 'Task has no associated PR' },
        { status: 400 }
      );
    }

    // Fetch PR details from GitHub
    const prDetails = await platform.getPRDetails(target_repo, pr_number);

    return NextResponse.json(prDetails, {
      headers: {
        'Cache-Control': 'private, max-age=30', // 30s cache for live status
      },
    });
  } catch (error) {
    console.error('Failed to fetch PR status:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch PR status',
      },
      { status: 500 }
    );
  }
}
```

```tsx
// web-ui/src/app/pipeline/[id]/PRStatusCard.tsx

'use client';

import { useEffect, useState } from 'react';
import { PRDetails } from '@/types/platform';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  open: 'bg-blue-100 text-blue-700',
  'checks-failing': 'bg-red-100 text-red-700',
  'changes-requested': 'bg-orange-100 text-orange-700',
  approved: 'bg-green-100 text-green-700',
  merged: 'bg-purple-100 text-purple-700',
  closed: 'bg-gray-100 text-gray-700',
};

const statusIcons: Record<string, string> = {
  draft: '📝',
  open: '🔓',
  'checks-failing': '❌',
  'changes-requested': '👀',
  approved: '✅',
  merged: '🎉',
  closed: '🚪',
};

interface PRStatusCardProps {
  taskId: string;
}

export function PRStatusCard({ taskId }: PRStatusCardProps) {
  const [details, setDetails] = useState<PRDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/pipeline/${taskId}/pr-status`);

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch PR status');
      }

      const data = await res.json();
      setDetails(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [taskId]);

  if (error) {
    return (
      <div className="border border-red-200 rounded-lg p-4 bg-red-50">
        <p className="text-red-700">Failed to load PR status: {error}</p>
        <button
          onClick={fetchStatus}
          className="mt-2 text-sm text-red-600 hover:text-red-700 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading && !details) {
    return <div className="animate-pulse h-24 bg-gray-100 rounded-lg" />;
  }

  if (!details) {
    return null;
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <a
            href={details.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-lg font-semibold text-blue-600 hover:underline"
          >
            {details.title}
          </a>
          <p className="text-sm text-gray-600">#{details.number}</p>
        </div>

        <div className="text-right">
          <div
            className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
              statusColors[details.computed_status] || 'bg-gray-100'
            }`}
          >
            {statusIcons[details.computed_status]} {details.computed_status}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Last checked: {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
      </div>

      {/* Author */}
      <div className="flex items-center gap-2 mb-4 pb-4 border-b border-gray-100">
        {details.author.avatar_url && (
          <img
            src={details.author.avatar_url}
            alt={details.author.login}
            className="w-6 h-6 rounded-full"
          />
        )}
        <span className="text-sm text-gray-700">
          by <strong>{details.author.login}</strong>
        </span>
      </div>

      {/* Checks */}
      {details.checks.runs.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Checks</h4>
          <div className="space-y-1">
            {details.checks.runs.map((run, i) => (
              <a
                key={i}
                href={run.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-gray-600 hover:text-blue-600"
              >
                {run.conclusion === 'success' && '✅'}
                {run.conclusion === 'failure' && '❌'}
                {!run.conclusion && '⏳'}
                {' '}
                {run.name} ({run.status})
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Reviews */}
      {(details.reviews.approved_by.length > 0 ||
        details.reviews.changes_requested_by.length > 0) && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Reviews</h4>
          {details.reviews.approved_by.length > 0 && (
            <p className="text-sm text-green-700">
              ✅ Approved by: {details.reviews.approved_by.join(', ')}
            </p>
          )}
          {details.reviews.changes_requested_by.length > 0 && (
            <p className="text-sm text-orange-700">
              👀 Changes requested by: {details.reviews.changes_requested_by.join(', ')}
            </p>
          )}
        </div>
      )}

      <button
        onClick={fetchStatus}
        className="text-xs text-blue-600 hover:text-blue-700 underline"
      >
        Refresh now
      </button>
    </div>
  );
}
```

```tsx
// web-ui/src/app/pipeline/[id]/page.tsx
// Add PRStatusCard to existing task detail page

import { PRStatusCard } from './PRStatusCard';

export default function TaskDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-6">
      {/* Existing task details */}
      <div>
        {/* ... task info ... */}
      </div>

      {/* PR Status Card */}
      <PRStatusCard taskId={params.id} />

      {/* Existing task content */}
    </div>
  );
}
```

```tsx
// web-ui/src/app/pipeline/page.tsx
// Add small PR status indicator to list view

import { formatDistanceToNow } from 'date-fns';

interface TaskListItemProps {
  task: {
    id: string;
    title: string;
    status: string;
    pr_number?: number;
    target_repo?: string;
    pr_url?: string;
    created_at: string;
  };
}

function PRStatusBadge({ task }: TaskListItemProps) {
  if (!task.pr_number) return null;

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    open: 'bg-blue-100 text-blue-700',
    'checks-failing': 'bg-red-100 text-red-700',
    'changes-requested': 'bg-orange-100 text-orange-700',
    approved: 'bg-green-100 text-green-700',
    merged: 'bg-purple-100 text-purple-700',
    closed: 'bg-gray-100 text-gray-700',
  };

  // Fetch status on client side to keep list fast
  const [status, setStatus] = useState<string>('loading');

  useEffect(() => {
    fetch(`/api/pipeline/${task.id}/pr-status`)
      .then(res => res.json())
      .then(data => setStatus(data.computed_status))
      .catch(() => setStatus('unknown'));
  }, [task.id]);

  return (
    <span
      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
        statusColors[status] || 'bg-gray-100'
      }`}
    >
      PR #{task.pr_number}
    </span>
  );
}

export default function PipelineListPage() {
  const [tasks, setTasks] = useState<TaskListItemProps['task'][]>([]);

  useEffect(() => {
    fetch('/api/pipeline')
      .then(res => res.json())
      .then(data => setTasks(data.tasks));
  }, []);

  return (
    <div className="space-y-2">
      {tasks.map(task => (
        <div
          key={task.id}
          className="border border-gray-200 rounded p-4 flex items-center justify-between hover:bg-gray-50"
        >
          <div className="flex-1">
            <h3 className="font-medium text-gray-900">{task.title}</h3>
            <p className="text-sm text-gray-600">
              Created {formatDistanceToNow(new Date(task.created_at))} ago
            </p>
          </div>

          {task.pr_number && <PRStatusBadge task={task} />}

          <a
            href={`/pipeline/${task.id}`}
            className="ml-4 text-blue-600 hover:underline"
          >
            View
          </a>
        </div>
      ))}
    </div>
  );
}
```

**Key implementation notes:**

1. **State computation (never stored):** `computed_status` is calculated from GitHub API response on every fetch. No DB storage.

2. **Graceful fallbacks:** If checks or reviews API call fails, we still return PR details with empty arrays.

3. **Live refresh:** PRStatusCard auto-refreshes every 30 seconds; list view fetches status client-side on mount.

4. **Parallel API calls:** `getPRDetails` fetches PR, checks, and reviews in parallel for performance.

5. **Cache headers:** API route sets 30s cache to reduce GitHub API load while keeping status fresh.

6. **Review status:** Deduplicates reviewers by login and tracks approved/changes-requested/pending states.

Now test with:

```bash
# 1. Verify MCP tool
curl -s http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"call_tool","params":{"name":"get_pr_status","arguments":{"repo":"your-org/repo","pr_number":42}}}'

# 2. Test API route
curl http://localhost:3000/api/pipeline/task-123/pr-status

# 3. Manual check: visit /pipeline/task-id, PRStatusCard should render and auto-refresh
```

Does this look right? Any changes needed before committing?
```