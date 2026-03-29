/**
 * Repo onboarding module.
 *
 * Lists repos the GitHub App can access, compares against lore.repos,
 * and submits onboarding tasks to the Klaus pipeline so an agent can
 * inspect the repo and generate customized CLAUDE.md / onboarding PRs.
 */

import { createBranch, commitFile, createPR, isConfigured as isGitHubConfigured, getOctokit } from './pipeline-github.js';
import { Octokit } from 'octokit';
import { createAppAuth } from '@octokit/auth-app';

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
  repo_id: string;
  task_id: string;
  status: string;
}

/**
 * Onboards a repo by inserting it into lore.repos and submitting an
 * "onboard" task to the Klaus pipeline. The agent will inspect the repo,
 * understand its tech stack, and generate a customized CLAUDE.md plus
 * supporting files — then open a single onboarding PR.
 */
export async function onboardRepo(pool: any, fullName: string): Promise<OnboardResult> {
  const [owner, name] = fullName.split('/');
  if (!owner || !name) {
    throw new Error(`Invalid repo full_name: "${fullName}". Expected "owner/repo" format.`);
  }

  // Insert into repos table (upsert — re-onboarding refreshes the timestamp)
  const { rows } = await pool.query(
    `INSERT INTO lore.repos (owner, name, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (full_name) DO UPDATE SET onboarded_at = now()
     RETURNING id`,
    [owner, name, fullName],
  );

  // Create a pipeline task for the onboarding agent
  const { createTask } = await import('./pipeline.js');
  const result = await createTask(
    fullName,       // description is the repo name
    'onboard',
    fullName,       // target_repo
    'onboard-system',
    { repo: fullName },
  );

  return { repo_id: rows[0].id, task_id: result.task_id, status: 'onboarding-agent-spawned' };
}

// ── Fetch repo context for onboarding agents ────────────────────────

export interface RepoContext {
  tree: string[];                  // list of top-level file/dir names
  files: Record<string, string>;   // path -> content for key files
  samples: Record<string, string>; // path -> first 200 lines of sampled source files
}

const KEY_FILES = [
  'README.md', 'CLAUDE.md', 'AGENTS.md', 'package.json', 'go.mod',
  'Cargo.toml', 'requirements.txt', 'Dockerfile', 'docker-compose.yml',
  'pom.xml', 'Makefile', 'tsconfig.json', 'pyproject.toml',
];

const SAMPLE_DIRS = ['src', 'lib', 'cmd', 'internal', 'app', 'pkg'];

/**
 * Decodes base64-encoded file content returned by the GitHub API.
 */
function decodeContent(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

/**
 * Fetches contextual information about a repo: top-level tree, key config
 * files, and a sample of source files from well-known directories.
 * Used by onboarding agents to understand a repo's tech stack.
 */
export async function fetchRepoContext(fullName: string): Promise<RepoContext> {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repo full_name: "${fullName}". Expected "owner/repo" format.`);
  }

  const octokit = await getOctokit();

  // 1. Fetch top-level tree
  let tree: string[] = [];
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: '' });
    if (Array.isArray(data)) {
      tree = data.map((entry: any) => entry.name);
    }
  } catch (err: any) {
    console.error(`[onboard] Failed to fetch tree for ${fullName}: ${err.message}`);
  }

  // 2. Fetch key files (skip 404s)
  const files: Record<string, string> = {};
  await Promise.all(
    KEY_FILES.map(async (path) => {
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
        if (!Array.isArray(data) && data.type === 'file' && data.content) {
          files[path] = decodeContent(data.content);
        }
      } catch (err: any) {
        if (err.status !== 404) {
          console.error(`[onboard] Error fetching ${fullName}/${path}: ${err.message}`);
        }
      }
    }),
  );

  // 3. Sample up to 3 source files from key directories
  const samples: Record<string, string> = {};
  for (const dir of SAMPLE_DIRS) {
    if (Object.keys(samples).length >= 3) break;

    let entries: any[] = [];
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: dir });
      if (Array.isArray(data)) {
        entries = data.filter((e: any) => e.type === 'file');
      }
    } catch (err: any) {
      if (err.status !== 404) {
        console.error(`[onboard] Error listing ${fullName}/${dir}: ${err.message}`);
      }
      continue;
    }

    for (const entry of entries) {
      if (Object.keys(samples).length >= 3) break;
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: entry.path });
        if (!Array.isArray(data) && data.type === 'file' && data.content) {
          const full = decodeContent(data.content);
          const first200 = full.split('\n').slice(0, 200).join('\n');
          samples[entry.path] = first200;
        }
      } catch (err: any) {
        console.error(`[onboard] Error fetching sample ${fullName}/${entry.path}: ${err.message}`);
      }
    }
  }

  return { tree, files, samples };
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
        await pool.query(
          `UPDATE lore.repos SET onboarding_pr_merged = true, last_ingested_at = now() WHERE id = $1`,
          [repo.id]
        );
        // Trigger initial ingestion via pipeline
        const { createTask } = await import('./pipeline.js');
        await createTask(
          `Initial ingestion for ${repo.full_name}: read CLAUDE.md, ADRs, runbooks, code structure`,
          'general',
          repo.full_name,
          'onboard-ingest'
        );
        console.log(`[repo-onboard] Onboarding PR merged for ${repo.full_name}, ingestion triggered`);
      }
    } catch (err: any) {
      console.error(`[repo-onboard] Error checking PR for ${repo.full_name}: ${err.message}`);
    }
  }
}
