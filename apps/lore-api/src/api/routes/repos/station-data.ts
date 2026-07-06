import type { ServerRoute } from "@hapi/hapi";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

/**
 * The data + write endpoints a detection station pod reaches over HTTP, so it
 * never opens Postgres or holds GitHub App creds (ADR-031 D6/D7). Each proxies
 * the shared Project facade server-side. Grouped in one array for registration.
 *
 *   GET  /repos/:o/:r/onboarded                → { onboarded }
 *   GET  /repos/:o/:r/issues?state=            → { issues }
 *   POST /repos/:o/:r/issues                   → the created issue
 *   POST /repos/:o/:r/branches                 → { ok }        (branch create)
 *   POST /repos/:o/:r/commit                   → { ok }        (commit a file)
 *   POST /repos/:o/:r/pulls                    → the opened PR
 *   GET  /repos/:o/:r/ci-conclusion?ref=       → { conclusion }
 *   GET  /repos/:o/:r/tasks/drift?…            → { tasks }     (spec_path dedup)
 *   GET  /repos/:o/:r/tasks/open-like?…        → { tasks }     (prefix dedup)
 *   POST /repos/:o/:r/tasks                     → the created task
 */
export function stationDataRoutes(): ServerRoute[] {
  const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;
  const fail = (h: import("@hapi/hapi").ResponseToolkit, err: unknown) =>
    h.response({ error: err instanceof Error ? err.message : String(err) }).code(500);

  return [
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/onboarded",
      options: bearerScope("read"),
      handler: async (request, h) => {
        try {
          const p = await projectFor(repoOf(request.params));
          return h.response({ onboarded: await p.settings.isOnboarded() });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/issues",
      options: bearerScope("read"),
      handler: async (request, h) => {
        try {
          const state = (request.query.state as "open" | "closed" | undefined) ?? "open";
          const p = await projectFor(repoOf(request.params));
          return h.response({ issues: await p.issues.list({ state }) });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/issues",
      options: bearerScope("write"),
      handler: async (request, h) => {
        try {
          const { title, body, labels } = request.payload as { title: string; body: string; labels?: string[] };
          const p = await projectFor(repoOf(request.params));
          return h.response(await p.issues.create(title, body, labels));
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/branches",
      options: bearerScope("write"),
      handler: async (request, h) => {
        try {
          const { branch, base } = request.payload as { branch: string; base?: string };
          const p = await projectFor(repoOf(request.params));
          await p.repo.createBranch(branch, base);
          return h.response({ ok: true });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/commit",
      options: bearerScope("write"),
      handler: async (request, h) => {
        try {
          const { branch, path, content, message } = request.payload as {
            branch: string;
            path: string;
            content: string;
            message: string;
          };
          const p = await projectFor(repoOf(request.params));
          await p.repo.commitFile(branch, path, content, message);
          return h.response({ ok: true });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/pulls",
      options: bearerScope("write"),
      handler: async (request, h) => {
        try {
          const { branch, title, body, base, labels } = request.payload as {
            branch: string;
            title: string;
            body: string;
            base?: string;
            labels?: string[];
          };
          const p = await projectFor(repoOf(request.params));
          return h.response(await p.pulls.open(branch, title, body, base, labels));
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/ci-conclusion",
      options: bearerScope("read"),
      handler: async (request, h) => {
        try {
          const ref = (request.query.ref as string | undefined) ?? "";
          if (!ref) return h.response({ error: "ref required" }).code(400);
          const p = await projectFor(repoOf(request.params));
          return h.response({ conclusion: await p.pulls.ciConclusion(ref) });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/tasks/drift",
      options: bearerScope("read"),
      handler: async (request, h) => {
        try {
          const q = request.query as Record<string, string | undefined>;
          if (!q.task_type || !q.spec_path) return h.response({ error: "task_type + spec_path required" }).code(400);
          const p = await projectFor(repoOf(request.params));
          return h.response({ tasks: await p.tasks.driftTasksForSpec(q.task_type, q.spec_path) });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/tasks/open-like",
      options: bearerScope("read"),
      handler: async (request, h) => {
        try {
          const q = request.query as Record<string, string | undefined>;
          if (!q.task_type || !q.description_prefix) {
            return h.response({ error: "task_type + description_prefix required" }).code(400);
          }
          const statuses = (q.statuses ?? "").split(",").filter(Boolean);
          const p = await projectFor(repoOf(request.params));
          return h.response({
            tasks: await p.tasks.findOpenLike({ taskType: q.task_type, descriptionPrefix: q.description_prefix, statuses }),
          });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/tasks",
      options: bearerScope("task"),
      handler: async (request, h) => {
        try {
          const body = request.payload as {
            description: string;
            taskType: string;
            createdBy?: string;
            contextBundle?: Record<string, unknown>;
          };
          const p = await projectFor(repoOf(request.params));
          const created = await p.tasks.create({
            description: body.description,
            taskType: body.taskType,
            createdBy: body.createdBy,
            contextBundle: body.contextBundle,
          });
          return h.response(created);
        } catch (err) {
          return fail(h, err);
        }
      },
    },
  ];
}
