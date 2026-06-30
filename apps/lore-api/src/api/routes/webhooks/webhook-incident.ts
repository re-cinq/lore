import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { json, readBody } from "../http.js";

export async function handleIncidentWebhook(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const body = await readBody(req);
  try {
    const payload = JSON.parse(body);
    // Accept both direct format and PagerDuty/Opsgenie envelope
    const incident = payload.incident || payload;
    const repoName = incident.repo || incident.service?.name;
    if (!repoName) { json(res, 400, { error: "required: repo (or incident.repo)" }); return; }

    const entry = {
      title: incident.title || incident.summary || "Unknown incident",
      severity: incident.severity || incident.urgency || "unknown",
      date: incident.date || new Date().toISOString(),
      resolved: incident.resolved || incident.status === "resolved" || false,
      url: incident.url || incident.html_url || null,
    };

    // Upsert into lore.repos.settings.incidents (max 10, FIFO)
    await pool.query(
      `UPDATE lore.repos
       SET settings = jsonb_set(
         COALESCE(settings, '{}'),
         '{incidents}',
         (SELECT jsonb_agg(elem) FROM (
           SELECT elem FROM jsonb_array_elements(
             COALESCE(settings->'incidents', '[]') || $2::jsonb
           ) AS elem
           ORDER BY elem->>'date' DESC
           LIMIT 10
         ) sub)
       )
       WHERE full_name = $1`,
      [repoName, JSON.stringify(entry)],
    );
    json(res, 200, { ok: true, repo: repoName });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
