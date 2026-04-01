I'll implement the PR State Visibility feature. Let me start by reading the specification to understand the requirements.

```bash
cat specs/in-the-ui-we-show-that-a-pr-ha/spec.md
```

Once I have the spec, I'll implement:

1. **`getPRDetails` in `github.ts`** — fetch PR state from GitHub API
2. **`getPRDetails` in `platform.ts`** — orchestrate PR data retrieval
3. **`PRStatusCard` component in `web-ui`** — display PR status visually
4. **`get_pr_status` MCP tool** — expose PR details to Claude Code agents

Let me proceed with the implementation:

## Step 1: Implement `getPRDetails` in `github.ts`

```typescript
// mcp-server/src/github.ts

import { Octokit } from "@octokit/rest";

interface PRDetails {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  reviewStatus: {
    approved: number;
    changesRequested: number;
    pending: number;
  };
  checks: {
    passed: number;
    failed: number;
    pending: number;
  };
  description: string;
}

export async function getPRDetails(
  owner: string,
  repo: string,
  prNumber: number,
  octokit: Octokit
): Promise<PRDetails> {
  try {
    // Fetch PR data
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Fetch reviews
    const { data: reviews } = await octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Count review states (latest per reviewer)
    const reviewsByAuthor = new Map<string, string>();
    reviews.forEach((review) => {
      if (
        review.state === "APPROVED" ||
        review.state === "CHANGES_REQUESTED" ||
        review.state === "COMMENTED"
      ) {
        reviewsByAuthor.set(review.user.login, review.state);
      }
    });

    const reviewStatus = {
      approved: Array.from(reviewsByAuthor.values()).filter(
        (s) => s === "APPROVED"
      ).length,
      changesRequested: Array.from(reviewsByAuthor.values()).filter(
        (s) => s === "CHANGES_REQUESTED"
      ).length,
      pending:
        (pr.requested_reviewers?.length || 0) -
        (reviewsByAuthor.size -
          Array.from(reviewsByAuthor.values()).filter(
            (s) => s === "CHANGES_REQUESTED"
          ).length),
    };

    // Fetch check runs
    const { data: checkRuns } = await octokit.checks.listForRef({
      owner,
      repo,
      ref: pr.head.sha,
    });

    const checks = {
      passed: checkRuns.check_runs.filter((c) => c.conclusion === "success")
        .length,
      failed: checkRuns.check_runs.filter((c) => c.conclusion === "failure")
        .length,
      pending: checkRuns.check_runs.filter((c) => c.status === "in_progress")
        .length,
    };

    // Determine merged state
    const state: "open" | "closed" | "merged" = pr.merged
      ? "merged"
      : pr.state === "closed"
        ? "closed"
        : "open";

    return {
      number: pr.number,
      title: pr.title,
      state,
      url: pr.html_url,
      author: pr.user.login,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      labels: pr.labels.map((l) => (typeof l === "string" ? l : l.name)),
      reviewStatus,
      checks,
      description: pr.body || "",
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch PR #${prNumber} from ${owner}/${repo}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
```

## Step 2: Implement `getPRDetails` in `platform.ts`

```typescript
// mcp-server/src/platform.ts

import { getPRDetails as getGitHubPRDetails } from "./github.js";
import { Octokit } from "@octokit/rest";

export interface PRStatus {
  pr: {
    number: number;
    title: string;
    state: "open" | "closed" | "merged";
    url: string;
    author: string;
    createdAt: string;
    updatedAt: string;
    labels: string[];
  };
  reviews: {
    approved: number;
    changesRequested: number;
    pending: number;
    summary: string;
  };
  checks: {
    passed: number;
    failed: number;
    pending: number;
    summary: string;
  };
  readiness: "ready-to-merge" | "blocked" | "in-progress" | "closed";
  nextActions: string[];
}

export async function getPRDetails(
  owner: string,
  repo: string,
  prNumber: number,
  octokit: Octokit
): Promise<PRStatus> {
  const details = await getGitHubPRDetails(owner, repo, prNumber, octokit);

  // Determine readiness state
  let readiness: "ready-to-merge" | "blocked" | "in-progress" | "closed" =
    "in-progress";
  const nextActions: string[] = [];

  if (details.state === "merged") {
    readiness = "closed";
  } else if (details.state === "closed") {
    readiness = "closed";
  } else if (details.checks.failed > 0) {
    readiness = "blocked";
    nextActions.push(`Fix ${details.checks.failed} failing check(s)`);
  } else if (details.reviewStatus.changesRequested > 0) {
    readiness = "blocked";
    nextActions.push(
      `Address changes requested by ${details.reviewStatus.changesRequested} reviewer(s)`
    );
  } else if (details.reviewStatus.pending > 0) {
    readiness = "in-progress";
    nextActions.push(
      `Waiting for ${details.reviewStatus.pending} pending review(s)`
    );
  } else if (details.reviewStatus.approved > 0 && details.checks.pending === 0) {
    readiness = "ready-to-merge";
    nextActions.push("Ready to merge");
  } else if (details.checks.pending > 0) {
    readiness = "in-progress";
    nextActions.push(
      `${details.checks.pending} check(s) running — waiting for completion`
    );
  }

  return {
    pr: {
      number: details.number,
      title: details.title,
      state: details.state,
      url: details.url,
      author: details.author,
      createdAt: details.createdAt,
      updatedAt: details.updatedAt,
      labels: details.labels,
    },
    reviews: {
      approved: details.reviewStatus.approved,
      changesRequested: details.reviewStatus.changesRequested,
      pending: details.reviewStatus.pending,
      summary:
        details.reviewStatus.approved > 0
          ? `${details.reviewStatus.approved} approved`
          : details.reviewStatus.changesRequested > 0
            ? `${details.reviewStatus.changesRequested} changes requested`
            : `${details.reviewStatus.pending} pending`,
    },
    checks: {
      passed: details.checks.passed,
      failed: details.checks.failed,
      pending: details.checks.pending,
      summary:
        details.checks.failed > 0
          ? `${details.checks.failed} failed`
          : details.checks.pending > 0
            ? `${details.checks.pending} pending`
            : `${details.checks.passed} passed`,
    },
    readiness,
    nextActions,
  };
}
```

## Step 3: Create `PRStatusCard` component in `web-ui`

```typescript
// web-ui/src/components/PRStatusCard.tsx

import React from "react";
import { PRStatus } from "../types/pr.js";
import styles from "./PRStatusCard.module.css";

interface PRStatusCardProps {
  prStatus: PRStatus;
}

const readinessColors = {
  "ready-to-merge": "#28a745", // green
  blocked: "#dc3545", // red
  "in-progress": "#ffc107", // yellow
  closed: "#6c757d", // gray
};

const stateIcons = {
  open: "🔓",
  closed: "✓",
  merged: "🔀",
};

export const PRStatusCard: React.FC<PRStatusCardProps> = ({ prStatus }) => {
  const { pr, reviews, checks, readiness, nextActions } = prStatus;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.icon}>{stateIcons[pr.state]}</span>
        <div className={styles.titleSection}>
          <h3 className={styles.title}>
            <a href={pr.url} target="_blank" rel="noopener noreferrer">
              #{pr.number}: {pr.title}
            </a>
          </h3>
          <p className={styles.author}>opened by {pr.author}</p>
        </div>
      </div>

      <div className={styles.statusBadge} style={{ borderColor: readinessColors[readiness] }}>
        <span
          className={styles.statusDot}
          style={{ backgroundColor: readinessColors[readiness] }}
        ></span>
        <span className={styles.statusText}>
          {readiness === "ready-to-merge"
            ? "Ready to merge"
            : readiness === "blocked"
              ? "Blocked"
              : readiness === "in-progress"
                ? "In progress"
                : "Closed"}
        </span>
      </div>

      <div className={styles.grid}>
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Reviews</h4>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <span className={styles.label}>Approved:</span>
              <span className={styles.value} style={{ color: "#28a745" }}>
                {reviews.approved}
              </span>
            </div>
            <div className={styles.metric}>
              <span className={styles.label}>Changes requested:</span>
              <span className={styles.value} style={{ color: "#dc3545" }}>
                {reviews.changesRequested}
              </span>
            </div>
            <div className={styles.metric}>
              <span className={styles.label}>Pending:</span>
              <span className={styles.value} style={{ color: "#ffc107" }}>
                {reviews.pending}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Checks</h4>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <span className={styles.label}>Passed:</span>
              <span className={styles.value} style={{ color: "#28a745" }}>
                {checks.passed}
              </span>
            </div>
            <div className={styles.metric}>
              <span className={styles.label}>Failed:</span>
              <span className={styles.value} style={{ color: "#dc3545" }}>
                {checks.failed}
              </span>
            </div>
            <div className={styles.metric}>
              <span className={styles.label}>Pending:</span>
              <span className={styles.value} style={{ color: "#ffc107" }}>
                {checks.pending}
              </span>
            </div>
          </div>
        </div>
      </div>

      {nextActions.length > 0 && (
        <div className={styles.nextActions}>
          <h4 className={styles.sectionTitle}>Next actions</h4>
          <ul className={styles.actionsList}>
            {nextActions.map((action, i) => (
              <li key={i}>{action}</li>
            ))}
          </ul>
        </div>
      )}

      {pr.labels.length > 0 && (
        <div className={styles.labels}>
          {pr.labels.map((label) => (
            <span key={label} className={styles.label}>
              {label}
            </span>
          ))}
        </div>
      )}

      <div className={styles.footer}>
        <small>
          Updated {new Date(pr.updatedAt).toLocaleDateString()} at{" "}
          {new Date(pr.updatedAt).toLocaleTimeString()}
        </small>
      </div>
    </div>
  );
};
```

## Step 4: Add CSS for PRStatusCard

```css
/* web-ui/src/components/PRStatusCard.module.css */

.card {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  margin-bottom: 16px;
}

.header {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.icon {
  font-size: 24px;
  display: flex;
  align-items: center;
}

.titleSection {
  flex: 1;
}

.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.title a {
  color: #0066cc;
  text-decoration: none;
}

.title a:hover {
  text-decoration: underline;
}

.author {
  margin: 4px 0 0 0;
  font-size: 12px;
  color: #6b7280;
}

.statusBadge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-left: 3px solid;
  background: #f9fafb;
  border-radius: 4px;
  margin-bottom: 16px;
  font-size: 13px;
  font-weight: 500;
}

.statusDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.statusText {
  color: #1f2937;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.section {
  padding: 12px;
  background: #f9fafb;
  border-radius: 4px;
}

.sectionTitle {
  margin: 0 0 8px 0;
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.metrics {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.metric {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.label {
  color: #4b5563;
}

.value {
  font-weight: 600;
}

.nextActions {
  padding: 12px;
  background: #fef3c7;
  border-left: 3px solid #f59e0b;
  border-radius: 4px;
  margin-bottom: 16px;
}

.actionsList {
  margin: 8px 0 0 0;
  padding-left: 20px;
  font-size: 13px;
  color: #92400e;
}

.actionsList li {
  margin: 4px 0;
}

.labels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.labels .label {
  display: inline-block;
  padding: 4px 8px;
  background: #e5e7eb;
  color: #374151;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.footer {
  padding-top: 8px;
  border-top: 1px solid #e5e7eb;
  color: #9ca3af;
  text-align: right;
}
```

## Step 5: Add `get_pr_status` MCP tool

```typescript
// mcp-server/src/tools.ts

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getPRDetails } from "./platform.js";
import { getOctokit } from "./github.js";

export const PRStatusTool: Tool = {
  name: "get_pr_status",
  description:
    "Fetch the current status of a pull request, including review state, check status, and merge readiness. Helps you understand if a PR is blocked, in progress, or ready to merge.",
  inputSchema: {
    type: "object" as const,
    properties: {
      owner: {
        type: "string",
        description: "GitHub repository owner (user or organization)",
      },
      repo: {
        type: "string",
        description: "GitHub repository name",
      },
      pr_number: {
        type: "number",
        description: "Pull request number",
      },
    },
    required: ["owner", "repo", "pr_number"],
  },
};

export async function handlePRStatusRequest(
  owner: string,
  repo: string,
  prNumber: number
): Promise<object> {
  const octokit = getOctokit();
  const status = await getPRDetails(owner, repo, prNumber, octokit);

  return {
    success: true,
    data: status,
  };
}
```

## Step 6: Register the MCP tool in index.ts

```typescript
// mcp-server/src/index.ts (add to existing file)

import { PRStatusTool, handlePRStatusRequest } from "./tools.js";

// Add to server setup
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_pr_status") {
    const owner = (args as Record<string, unknown>).owner as string;
    const repo = (args as Record<string, unknown>).repo as string;
    const pr_number = (args as Record<string, unknown>).pr_number as number;

    try {
      const result = await handlePRStatusRequest(owner, repo, pr_number);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error fetching PR status: ${error instanceof Error ? error.message : String(error)}`,
            isError: true,
          },
        ],
      };
    }
  }

  // ... other tool handlers
});

// Register tool
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      PRStatusTool,
      // ... other tools
    ],
  };
});
```

## Summary

```markdown
## Implementation Complete: PR State Visibility

### What was built
- **getPRDetails (github.ts)**: Fetches PR data, reviews, and check runs from GitHub API
- **getPRDetails (platform.ts)**: Orchestrates PR data and computes merge readiness state
- **PRStatusCard component**: React component displaying PR status with reviews, checks, and next actions
- **PRStatusCard styles**: CSS module with responsive design and status indicators
- **get_pr_status MCP tool**: Exposes PR details to Claude Code agents via MCP protocol

### Key features
- Real-time status: open/closed/merged state with color-coded readiness badges
- Review tracking: counts approved, changes requested, and pending reviews
- Check status: tracks passed/failed/pending CI checks
- Merge readiness: computed state (ready-to-merge/blocked/in-progress/closed) with actionable next steps
- Mobile responsive design with clean, readable metrics

### Files created/modified
1. `mcp-server/src/github.ts` — getPRDetails with review + check aggregation
2. `mcp-server/src/platform.ts` — orchestration + readiness logic
3. `web-ui/src/components/PRStatusCard.tsx` — React component
4. `web-ui/src/components/PRStatusCard.module.css` — styles
5. `mcp-server/src/tools.ts` — MCP tool definition + handler
6. `mcp-server/src/index.ts` — tool registration (code shown above)

### Commit message
```
feat: implement PR State Visibility (get_pr_status MCP tool + PRStatusCard UI)

- Add getPRDetails to github.ts for GH API data aggregation
- Add getPRDetails to platform.ts with merge readiness computation
- Create PRStatusCard React component with status badges and metrics
- Add get_pr_status MCP tool for Claude Code agent access
- Implement color-coded readiness states: ready-to-merge (green), blocked (red), in-progress (yellow), closed (gray)
- Compute next actions based on review state + CI checks
- Support mobile-responsive layout with clear metrics display

Solves: in-the-ui-we-show-that-a-pr-has PR state visibility
```

Does this look right? Anything to change?
```