import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { redactSecrets as sanitizeContent } from "@re-cinq/lore-shared";
import { getQueryEmbedding } from "../../platform/db.js";
import { isMemoryDbAvailable, writeMemory, readMemory, deleteMemory, listMemories } from "../../features/memory/memory.js";
import { writeMemoryFile, readMemoryFile, deleteMemoryFile, listMemoriesFile, searchMemoryFile } from "../../features/memory/memory-file.js";
import { searchMemories } from "../../features/memory/memory-search.js";
import { extractFactsFromEpisode } from "../../features/memory/facts.js";
import { extractAndUpdateGraph } from "../../features/memory/graph.js";
import { json, readBody } from "./http.js";
import { makeGraphLlmCall } from "./helpers.js";

export async function handleMemory(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const body = await readBody(req);
  try {
    const { action, key, value, agent_id, ttl, query: searchQuery, limit, version, pool_name, repo } = JSON.parse(body);
    let result: any;
    const embedding = (action === "write" || action === "search") && (value || searchQuery) ? await getQueryEmbedding(value || searchQuery) : null;

    switch (action) {
      case "write":
        if (!key || !value) { json(res, 400, { error: "key and value required" }); return; }
        result = isMemoryDbAvailable()
          ? await writeMemory(key, value, agent_id, ttl, embedding || undefined, repo)
          : await writeMemoryFile(key, value, agent_id, ttl);
        break;
      case "read":
        if (!key) { json(res, 400, { error: "key required" }); return; }
        result = isMemoryDbAvailable()
          ? await readMemory(key, agent_id, version === "all" ? "all" : version ? Number(version) : undefined)
          : await readMemoryFile(key, agent_id, version === "all" ? "all" : version ? Number(version) : undefined);
        break;
      case "search":
        if (!searchQuery) { json(res, 400, { error: "query required" }); return; }
        result = isMemoryDbAvailable()
          ? await searchMemories(pool!, searchQuery, agent_id, pool_name, limit || 10)
          : await searchMemoryFile(searchQuery, agent_id, limit || 10);
        break;
      case "delete":
        if (!key) { json(res, 400, { error: "key required" }); return; }
        result = isMemoryDbAvailable()
          ? await deleteMemory(key, agent_id)
          : await deleteMemoryFile(key, agent_id);
        break;
      case "list":
        result = isMemoryDbAvailable()
          ? await listMemories(agent_id, limit || 50, 0)
          : await listMemoriesFile(agent_id, limit || 50, 0);
        break;
      default:
        json(res, 400, { error: "action must be: write, read, search, delete, list" });
        return;
    }
    json(res, 200, result);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handleEpisode(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const body = await readBody(req);
  try {
    const { content, source, ref, agent_id } = JSON.parse(body);
    if (!content) { json(res, 400, { error: "content required" }); return; }
    const agent = agent_id || 'unknown';
    const safeContent = sanitizeContent(content);
    const contentHash = createHash("sha256").update(safeContent).digest("hex");
    const { rows } = await pool!.query(
      `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (agent_id, content_hash) DO NOTHING
       RETURNING id`,
      [agent, safeContent, contentHash, source || 'session', ref || null],
    );
    if (rows.length === 0) {
      json(res, 200, { status: "duplicate" });
      return;
    }
    extractFactsFromEpisode(rows[0].id, safeContent, agent, pool!).catch(() => {});
    const gLlm = makeGraphLlmCall(pool);
    if (gLlm) extractAndUpdateGraph(pool!, safeContent, ref || null, rows[0].id, null, gLlm).catch(() => {});
    json(res, 200, { status: "ok", episode_id: rows[0].id });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handleSessionSummary(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  const body = await readBody(req);
  try {
    const { session_log, repo, agent_id } = JSON.parse(body);
    if (!session_log) { json(res, 400, { error: "required: session_log" }); return; }

    const summary = typeof session_log === "string"
      ? session_log
      : (session_log.summary || JSON.stringify(session_log));

    if (!summary || summary.length < 10) {
      json(res, 200, { status: "skipped", reason: "empty session" });
      return;
    }

    const content = `Session in ${repo || "unknown"}\n\n${summary}`;
    const agent = agent_id || "session-hook";
    const contentHash = createHash("sha256").update(content).digest("hex");

    if (!pool) { json(res, 503, { error: "database not available" }); return; }

    const { rows } = await pool.query(
      `INSERT INTO memory.episodes (agent_id, content, content_hash, source, ref)
       VALUES ($1, $2, $3, 'session', $4)
       ON CONFLICT (agent_id, content_hash) DO NOTHING
       RETURNING id`,
      [agent, content, contentHash, repo || null],
    );

    if (rows.length === 0) {
      json(res, 200, { status: "duplicate" });
      return;
    }

    extractFactsFromEpisode(rows[0].id, content, agent, pool).catch(() => {});
    const gLlm = makeGraphLlmCall(pool);
    if (gLlm) extractAndUpdateGraph(pool, content, repo || null, rows[0].id, null, gLlm).catch(() => {});
    json(res, 200, { status: "ok", episode_id: rows[0].id });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
