/**
 * Incremental file ingestion module.
 *
 * Fetches file content from GitHub, classifies it, upserts into the
 * appropriate schema's chunks table, and generates Vertex AI embeddings.
 * Called by the /api/ingest HTTP endpoint when GitHub Actions pushes.
 */

import { getOctokit, isAppConfigured as isConfigured } from './github-client.js';
import { getQueryEmbedding } from './db.js';
import { chunkFile } from '@re-cinq/lore-shared';

export interface IngestResult {
  file: string;
  status: 'ingested' | 'deleted' | 'skipped' | 'error';
  chunk_id?: string;
  embedded?: boolean;
  error?: string;
}

const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;

function classifyFile(path: string): string | null {
  // Skip binary / non-textual files
  if (/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|pdf|zip|tar|gz|lock)$/i.test(path)) return null;

  if (path.endsWith('CLAUDE.md') || path.endsWith('AGENTS.md') || path.endsWith('CODEOWNERS')) return 'doc';
  if (/(?:^|\/)adrs\//.test(path)) return 'adr';
  if (/(?:^|\/)specs\//.test(path) || path.startsWith('.specify/')) return 'spec';
  if (/(?:^|\/)runbooks\//.test(path)) return 'doc';
  if (/\.(ts|js|py|go|sh|rs|java|rb|kt|c|cpp|h|hpp)$/.test(path)) return 'code';
  if (path.endsWith('.md') || path.endsWith('.yaml') || path.endsWith('.yml')) return 'doc';
  return null; // skip unknown file types
}

async function resolveSchema(pool: any, repo: string): Promise<string> {
  try {
    const { rows } = await pool.query(
      `SELECT team FROM lore.repos WHERE full_name = $1`,
      [repo],
    );
    const team = rows[0]?.team;
    if (team && SCHEMA_RE.test(team)) {
      // Verify schema exists in DB
      const { rows: schemas } = await pool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
        [team],
      );
      if (schemas.length > 0) return team;
    }
  } catch (err) {
    console.error('[ingest] Schema resolution error:', err);
  }
  return 'org_shared';
}

export type IngestFile = string | { path: string; content: string };

export async function ingestFiles(
  pool: any,
  files: IngestFile[],
  repo: string,
  commit: string,
): Promise<{ ingested: number; deleted: number; errors: number; schema: string; results: IngestResult[] }> {
  const schema = await resolveSchema(pool, repo);

  if (!SCHEMA_RE.test(schema)) {
    throw new Error(`Invalid schema name: ${schema}`);
  }

  // Determine if we need GitHub access (only for path-based files)
  const needsGitHub = files.some((f) => typeof f === 'string');
  let octokit: any;
  let owner = '';
  let repoName = '';
  if (needsGitHub) {
    if (!isConfigured()) {
      throw new Error('GitHub App not configured — cannot fetch file content');
    }
    octokit = await getOctokit();
    [owner, repoName] = repo.split('/');
  }

  const results: IngestResult[] = [];
  let ingested = 0;
  let deleted = 0;
  let errors = 0;

  for (const fileEntry of files) {
    const filePath = typeof fileEntry === 'string' ? fileEntry : fileEntry.path;
    try {
      let content: string | null = null;

      if (typeof fileEntry !== 'string' && fileEntry.content) {
        // Content provided directly — no GitHub fetch needed
        content = fileEntry.content;
      } else {
        // Fetch from GitHub — try the given ref, fall back to default branch
        for (const ref of [commit, 'HEAD']) {
          try {
            const { data } = await octokit.rest.repos.getContent({
              owner,
              repo: repoName,
              path: filePath,
              ref,
            });
            if ('content' in data) {
              content = Buffer.from(data.content, 'base64').toString('utf-8');
            }
            break; // success
          } catch (err: any) {
            if (err.status === 404 && ref === commit && commit !== 'HEAD') {
              // Commit doesn't exist in this repo — retry with HEAD
              continue;
            }
            if (err.status === 404) {
              // File genuinely doesn't exist — remove from chunks
              await pool.query(
                `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
                [filePath, repo],
              );
              results.push({ file: filePath, status: 'deleted' });
              deleted++;
              break;
            }
            throw err;
          }
        }
        if (!content && results[results.length - 1]?.status === 'deleted') continue;
      }

      if (!content) {
        results.push({ file: filePath, status: 'skipped', error: 'not a file (directory?)' });
        continue;
      }

      const contentType = classifyFile(filePath);
      if (!contentType) {
        results.push({ file: filePath, status: 'skipped', error: 'unsupported file type' });
        continue;
      }

      // Upsert: delete old chunks for this file
      await pool.query(
        `DELETE FROM ${schema}.chunks WHERE file_path = $1 AND repo = $2`,
        [filePath, repo],
      );

      // Chunk the file using AST-based chunking (code) or heading-based (docs)
      const chunks = await chunkFile(content, filePath, contentType);

      let firstChunkId: string | undefined;
      let embedded = false;

      for (const chunk of chunks) {
        const { rows } = await pool.query(
          `INSERT INTO ${schema}.chunks (content, content_type, team, repo, file_path, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            chunk.content,
            contentType,
            schema,
            repo,
            filePath,
            JSON.stringify({ ...chunk.metadata, commit, file_path: filePath, ingested_by: 'api' }),
          ],
        );

        const chunkId = rows[0]?.id;
        if (!firstChunkId) firstChunkId = chunkId;

        // Generate and store embedding per chunk (cap input at 8k chars as safety net)
        const embedding = await getQueryEmbedding(chunk.content.substring(0, 8000));
        if (embedding && chunkId) {
          const embeddingStr = `[${embedding.join(',')}]`;
          await pool.query(
            `UPDATE ${schema}.chunks SET embedding = $1::vector WHERE id = $2`,
            [embeddingStr, chunkId],
          );
          embedded = true;
        }
      }

      results.push({ file: filePath, status: 'ingested', chunk_id: firstChunkId, embedded });
      ingested++;
    } catch (err: any) {
      console.error(`[ingest] Error processing ${filePath}:`, err.message);
      results.push({ file: filePath, status: 'error', error: err.message });
      errors++;
    }
  }

  console.error(`[ingest] ${repo}@${commit.slice(0, 7)}: ${ingested} ingested, ${deleted} deleted, ${errors} errors (schema: ${schema})`);
  return { ingested, deleted, errors, schema, results };
}
