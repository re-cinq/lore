/**
 * Repo onboarding module.
 *
 * Lists repos the GitHub App can access, compares against lore.repos,
 * and creates onboarding PRs with skeleton templates.
 */

import { createBranch, commitFile, createPR, isConfigured as isGitHubConfigured, getOctokit } from './pipeline-github.js';
import { Octokit } from 'octokit';
import { createAppAuth } from '@octokit/auth-app';

// ── Template content ────────────────────────────────────────────────

const TEMPLATES: Record<string, string> = {
  'CLAUDE.md': `# Engineering Guide\n\n## Architecture\n\n<!-- Describe service communication patterns... -->\n\n## Code Conventions\n\n<!-- Error handling, logging, auth patterns... -->\n\n## Key Services\n\n<!-- List main services and what they own... -->`,
  'AGENTS.md': `# Agent Instructions\n\n## Task Tracking\n- Run \`bd ready\` to see unblocked work\n- Run \`bd update <id> --claim\` before starting\n- Run \`bd update <id> --status done\` when complete\n\n## Context\n- Org and team context loaded via Lore MCP\n- Use /lore-feature for new features\n- Use /lore-pr for PR descriptions`,
  '.github/PULL_REQUEST_TEMPLATE.md': `## Why\n<!-- What problem? -->\n\n## Approach\n<!-- How? -->\n\n## Alternatives rejected\n<!-- Required. -->\n\n## ADR references\n<!-- Links -->\n\n## Spec\n<!-- Link to spec -->`,
};

// ── Installation repos ──────────────────────────────────────────────

export interface InstallationRepo {
  full_name: string;
  owner: string;
  name: string;
}

/**
 * Lists all repositories the GitHub App installation has access to.
 */
export async function getInstallationRepos(): Promise<InstallationRepo[]> {
  const octokit = await getOctokit();
  const repos: InstallationRepo[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
      per_page: perPage,
      page,
    });

    for (const repo of data.repositories) {
      repos.push({
        full_name: repo.full_name,
        owner: repo.owner?.login || repo.full_name.split('/')[0],
        name: repo.name,
      });
    }

    if (data.repositories.length < perPage) break;
    page++;
  }

  return repos;
}

// ── Database queries ────────────────────────────────────────────────

export interface OnboardedRepo {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  team: string | null;
  onboarded_at: string;
  last_ingested_at: string | null;
  onboarding_pr_url: string | null;
  onboarding_pr_merged: boolean;
  settings: any;
}

/**
 * Returns all repos from lore.repos.
 */
export async function getOnboardedRepos(pool: any): Promise<OnboardedRepo[]> {
  const { rows } = await pool.query(
    `SELECT id, owner, name, full_name, team, onboarded_at, last_ingested_at,
            onboarding_pr_url, onboarding_pr_merged, settings
     FROM lore.repos
     ORDER BY onboarded_at DESC`
  );
  return rows;
}

/**
 * Returns repos with pipeline task counts.
 */
export async function getOnboardedReposWithCounts(pool: any): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT r.id, r.owner, r.name, r.full_name, r.team,
            r.onboarded_at, r.last_ingested_at,
            r.onboarding_pr_url, r.onboarding_pr_merged, r.settings,
            COALESCE(tc.task_count, 0)::int AS task_count
     FROM lore.repos r
     LEFT JOIN (
       SELECT target_repo, COUNT(*) AS task_count
       FROM pipeline.tasks
       GROUP BY target_repo
     ) tc ON tc.target_repo = r.full_name
     ORDER BY r.onboarded_at DESC`
  );
  return rows;
}

/**
 * Returns installation repos that are NOT yet in lore.repos.
 */
export async function getAvailableRepos(pool: any): Promise<InstallationRepo[]> {
  const [installation, onboarded] = await Promise.all([
    getInstallationRepos(),
    getOnboardedRepos(pool),
  ]);

  const onboardedSet = new Set(onboarded.map(r => r.full_name));
  return installation.filter(r => !onboardedSet.has(r.full_name));
}

// ── Onboard a repo ──────────────────────────────────────────────────

export interface OnboardResult {
  full_name: string;
  pr_url: string;
  repo_id: string;
}

/**
 * Onboards a repo: creates a branch, commits template files, opens a PR,
 * and inserts a row into lore.repos.
 */
export async function onboardRepo(pool: any, fullName: string): Promise<OnboardResult> {
  if (!isGitHubConfigured()) {
    throw new Error('GitHub App not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID');
  }

  const [owner, name] = fullName.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid repo full_name: "${fullName}". Expected "owner/repo" format.`);
  }

  // Check if already onboarded
  const { rows: existing } = await pool.query(
    `SELECT id FROM lore.repos WHERE full_name = $1`,
    [fullName],
  );
  if (existing.length > 0) {
    throw new Error(`Repo "${fullName}" is already onboarded (id: ${existing[0].id}).`);
  }

  const branchName = 'lore/onboarding';

  // 1. Create branch
  await createBranch(fullName, branchName);

  // 2. Commit template files
  for (const [path, content] of Object.entries(TEMPLATES)) {
    await commitFile(fullName, branchName, path, content, `chore(lore): add ${path}`);
  }

  // 3. Open PR
  const { url: prUrl } = await createPR(
    fullName,
    branchName,
    'chore(lore): onboard repo with engineering templates',
    [
      '## Lore Onboarding',
      '',
      'This PR adds the baseline engineering templates for Lore-powered development:',
      '',
      '- **CLAUDE.md** — Engineering guide skeleton (architecture, conventions, key services)',
      '- **AGENTS.md** — Instructions for Claude Code agents using Lore MCP',
      '- **.github/PULL_REQUEST_TEMPLATE.md** — PR template with Why / Alternatives / ADR sections',
      '',
      'Please review and customise the placeholders for your repo.',
    ].join('\n'),
    'main',
    ['lore-onboarding'],
  );

  // 4. Insert into lore.repos
  const { rows } = await pool.query(
    `INSERT INTO lore.repos (owner, name, full_name, onboarding_pr_url)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [owner, name, fullName, prUrl],
  );

  return {
    full_name: fullName,
    pr_url: prUrl,
    repo_id: rows[0].id,
  };
}

// ── Onboarding PR merge detection (T018) ────────────────────────────

/**
 * Checks all repos with unmerged onboarding PRs. When a PR is found to
 * be merged, flips onboarding_pr_merged to true and sets last_ingested_at
 * so the nightly CronJob picks it up for initial ingestion (T019).
 */
export async function checkOnboardingPRs(pool: any): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, full_name, onboarding_pr_url FROM lore.repos
     WHERE onboarding_pr_merged = false AND onboarding_pr_url IS NOT NULL`
  );
  for (const repo of rows) {
    try {
      // Extract PR number from URL
      const match = repo.onboarding_pr_url.match(/\/pull\/(\d+)/);
      if (!match) continue;
      const prNumber = parseInt(match[1]);
      const [owner, name] = repo.full_name.split('/');

      // Check PR status via GitHub API
      const octokit = await getOctokit();
      const { data: pr } = await octokit.rest.pulls.get({ owner, repo: name, pull_number: prNumber });

      if (pr.merged) {
        // T019: Mark merged and set last_ingested_at so nightly ingestion picks it up
        await pool.query(
          `UPDATE lore.repos
             SET onboarding_pr_merged = true,
                 last_ingested_at = now()
           WHERE id = $1`,
          [repo.id]
        );
        console.log(`[repo-onboard] Onboarding PR merged for ${repo.full_name}`);
      }
    } catch (err: any) {
      console.error(`[repo-onboard] Error checking PR for ${repo.full_name}: ${err.message}`);
    }
  }
}
