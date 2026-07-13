import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { rawBody } from "../../../server/raw-body.js";

export function incidentWebhookRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/webhook/incident",
    // Auth-exempt like the other /api/webhook/* ingress routes.
    options: { auth: false, payload: { parse: false } },
    handler: async (request, h) => {
      const pool = getPool();
      if (!pool)
        return h.response({ error: "database not available" }).code(503);
      try {
        const payload = JSON.parse(rawBody(request));
        // Accept both direct format and PagerDuty/Opsgenie envelope
        const incident = payload.incident || payload;
        const repoName = incident.repo || incident.service?.name;
        if (!repoName)
          return h
            .response({ error: "required: repo (or incident.repo)" })
            .code(400);

        const entry = {
          title: incident.title || incident.summary || "Unknown incident",
          severity: incident.severity || incident.urgency || "unknown",
          date: incident.date || new Date().toISOString(),
          resolved:
            incident.resolved || incident.status === "resolved" || false,
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
        return h.response({ ok: true, repo: repoName });
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
