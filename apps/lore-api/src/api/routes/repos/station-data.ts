import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { projectFor } from "../../../platform/project-boot.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  PipelineTaskSchema,
  PIPELINE_TASK_COLUMNS,
} from "@re-cinq/lore-shared/models/pipeline-task.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";

const IssueBody = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).optional(),
});
const BranchBody = z.object({
  branch: z.string(),
  base: z.string().optional(),
});
const CommitBody = z.object({
  branch: z.string(),
  path: z.string(),
  content: z.string(),
  message: z.string(),
});
const PullBody = z.object({
  branch: z.string(),
  title: z.string(),
  body: z.string(),
  base: z.string().optional(),
  labels: z.array(z.string()).optional(),
});
const TaskBody = z.object({
  description: z.string(),
  taskType: z.string(),
  createdBy: z.string().optional(),
  contextBundle: z.record(z.unknown()).optional(),
});

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
/**
 * The bodies a STATION POD reads. A pod reaches neither Postgres nor the GitHub
 * App (ADR-031 D6/D7), so these are its whole view of a repo — which is exactly
 * why they are worth declaring: the pod ships as its own image, and an
 * undeclared body is one nothing can check across that boundary.
 */
const IssueRefSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  labels: z.array(z.string()),
  url: z.string().optional(),
});

const PullRefSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  branch: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  labels: z.array(z.string()),
  url: z.string(),
  author: z.string().optional(),
  draft: z.boolean().optional(),
});

const OnboardedSchema = z.object({ onboarded: z.boolean() });
const IssueListSchema = z.object({ issues: z.array(IssueRefSchema) });
const LabelListSchema = z.object({ labels: z.array(z.string()) });
const OkSchema = z.object({ ok: z.literal(true) });
const CiConclusionSchema = z.object({
  conclusion: z.enum(["success", "failure", "pending", "none"]),
});

/** What `tasks.create` answers with — the queued task's identity, not its row. */
const StationTaskCreatedSchema = z.object({
  task_id: z.string(),
  task_type: z.string(),
  status: z.string(),
  priority: z.string(),
  created_at: z.string(),
});

/** The task rows a detector compares against — the wire shape, as stored. */
const StationTaskListSchema = z.object({
  tasks: z.array(
    wireSchema(PipelineTaskSchema, PIPELINE_TASK_COLUMNS).partial(),
  ),
});

export function stationDataRoutes(): ServerRoute[] {
  const repoOf = (p: Record<string, string>) => `${p.owner}/${p.repo}`;
  const fail = (h: import("@hapi/hapi").ResponseToolkit, err: unknown) =>
    h
      .response({ error: err instanceof Error ? err.message : String(err) })
      .code(500);

  return [
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/onboarded",
      options: zodResponse(bearerScope("read"), OnboardedSchema, {
        name: "RepoOnboarded",
        description: "Whether the repo has completed onboarding",
      }),
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
      options: zodResponse(bearerScope("read"), IssueListSchema, {
        name: "RepoIssueList",
        description: "The repo's issues",
      }),
      handler: async (request, h) => {
        try {
          const state =
            (request.query.state as "open" | "closed" | undefined) ?? "open";
          const p = await projectFor(repoOf(request.params));

          return h.response({ issues: await p.issues.list({ state }) });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/labels",
      options: zodResponse(bearerScope("read"), LabelListSchema, {
        name: "RepoLabelList",
        description: "The repo's labels",
      }),
      handler: async (request, h) => {
        try {
          const p = await projectFor(repoOf(request.params));

          return h.response({ labels: await p.issues.listLabels() });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/issues",
      options: zodResponse(
        {
          ...bearerScope("write"),
          validate: { payload: zodValidate(IssueBody) },
        },
        IssueRefSchema,
        { name: "RepoIssueCreated", description: "The issue that was opened" },
      ),
      handler: async (request, h) => {
        try {
          const { title, body, labels } = request.payload as z.infer<
            typeof IssueBody
          >;
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
      options: zodResponse(
        {
          ...bearerScope("write"),
          validate: { payload: zodValidate(BranchBody) },
        },
        OkSchema,
        { name: "BranchCreated", description: "The branch was created" },
      ),
      handler: async (request, h) => {
        try {
          const { branch, base } = request.payload as z.infer<
            typeof BranchBody
          >;
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
      options: zodResponse(
        {
          ...bearerScope("write"),
          validate: { payload: zodValidate(CommitBody) },
        },
        OkSchema,
        { name: "CommitCreated", description: "The commit was pushed" },
      ),
      handler: async (request, h) => {
        try {
          const { branch, path, content, message } = request.payload as z.infer<
            typeof CommitBody
          >;
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
      options: zodResponse(
        {
          ...bearerScope("write"),
          validate: { payload: zodValidate(PullBody) },
        },
        PullRefSchema,
        { name: "PullOpened", description: "The pull request that was opened" },
      ),
      handler: async (request, h) => {
        try {
          const { branch, title, body, base, labels } =
            request.payload as z.infer<typeof PullBody>;
          const p = await projectFor(repoOf(request.params));

          return h.response(
            await p.pulls.open(branch, title, body, base, labels),
          );
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/ci-conclusion",
      options: zodResponse(bearerScope("read"), CiConclusionSchema, {
        name: "RepoCiConclusion",
        description: "CI's verdict for a ref",
      }),
      handler: async (request, h) => {
        try {
          const ref = (request.query.ref as string | undefined) ?? "";

          if (!ref) {
            return h.response({ error: "ref required" }).code(400);
          }
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
      options: zodResponse(bearerScope("read"), StationTaskListSchema, {
        name: "DriftTaskList",
        description: "Tasks already open for a spec",
      }),
      handler: async (request, h) => {
        try {
          const q = request.query as Record<string, string | undefined>;

          if (!q.task_type || !q.spec_path) {
            return h
              .response({ error: "task_type + spec_path required" })
              .code(400);
          }
          const p = await projectFor(repoOf(request.params));

          return h.response({
            tasks: await p.tasks.driftTasksForSpec(q.task_type, q.spec_path),
          });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/repos/{owner}/{repo}/tasks/open-like",
      options: zodResponse(bearerScope("read"), StationTaskListSchema, {
        name: "OpenLikeTaskList",
        description: "Open tasks matching a prefix",
      }),
      handler: async (request, h) => {
        try {
          const q = request.query as Record<string, string | undefined>;

          if (!q.task_type || !q.description_prefix) {
            return h
              .response({ error: "task_type + description_prefix required" })
              .code(400);
          }
          const statuses = (q.statuses ?? "").split(",").filter(Boolean);
          const p = await projectFor(repoOf(request.params));

          return h.response({
            tasks: await p.tasks.findOpenLike({
              taskType: q.task_type,
              descriptionPrefix: q.description_prefix,
              statuses,
            }),
          });
        } catch (err) {
          return fail(h, err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/repos/{owner}/{repo}/tasks",
      options: zodResponse(
        {
          ...bearerScope("task"),
          validate: { payload: zodValidate(TaskBody) },
        },
        StationTaskCreatedSchema,
        { name: "StationTaskCreated", description: "The task that was queued" },
      ),
      handler: async (request, h) => {
        try {
          const body = request.payload as z.infer<typeof TaskBody>;
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
