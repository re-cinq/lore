import "server-only";
import type {
  PlanDocument,
  PlanKind,
  PlanMeta,
} from "@re-cinq/planning-document";
import { apiFetch } from "./client";
import type { ApiResult } from "./result";
import type { components } from "./schema";

// Plans live in lore-api (ADR-047): the /api/plans routes are planning-sync's own, the repo-scoped ones are Lore's.
type PlanList = components["schemas"]["PlanList"];
type CollabToken = components["schemas"]["PlanCollabToken"];

export type PlanSummary = PlanList["plans"][number];

export interface NewPlan {
  repo: string;
  title: string;
  type: PlanKind;
  createdBy: string;
}

export interface StoredPlan {
  json: PlanDocument;
  contentHash: string;
  version: number;
}

export function listPlans(repo: string): Promise<ApiResult<PlanList>> {
  return apiFetch("lore-api", `/api/repos/${repo}/plans`);
}

export function createPlan(
  plan: NewPlan,
): Promise<ApiResult<{ meta: PlanMeta; documentName: string }>> {
  return apiFetch("lore-api", "/api/plans", { method: "POST", body: plan });
}

export function readPlan(planId: string): Promise<ApiResult<StoredPlan>> {
  return apiFetch("lore-api", `/api/plans/${planId}`);
}

/** Lore's own approve: refused before the status flips while the planning agent is still writing. */
export function approvePlan(
  repo: string,
  planId: string,
  approvedBy: string,
): Promise<ApiResult<PlanMeta>> {
  return apiFetch("lore-api", `/api/repos/${repo}/plans/${planId}/approve`, {
    method: "POST",
    body: { approvedBy },
  });
}

/** Reopens an approved plan for writing; an open spec PR is sent back to the author. */
export function reopenPlan(
  repo: string,
  planId: string,
  reopenedBy: string,
): Promise<ApiResult<PlanMeta>> {
  return apiFetch("lore-api", `/api/repos/${repo}/plans/${planId}/reopen`, {
    method: "POST",
    body: { reopenedBy },
  });
}

/** Removes the plan for good, with its document and versions. */
export function deletePlan(
  repo: string,
  planId: string,
): Promise<ApiResult<{ id: string }>> {
  return apiFetch("lore-api", `/api/repos/${repo}/plans/${planId}`, {
    method: "DELETE",
  });
}

/** A fresh spec pass for an approved plan whose spec work failed, or whose specs merged and need revising. */
export function startSpecWork(
  repo: string,
  planId: string,
  createdBy: string,
): Promise<ApiResult<{ task_id: string }>> {
  return apiFetch("lore-api", `/api/repos/${repo}/plans/${planId}/spec-work`, {
    method: "POST",
    body: { createdBy },
  });
}

/** A short-lived token that opens the plan's socket as this person; the caller has already checked their access to the repo. */
export function mintCollabToken(
  repo: string,
  planId: string,
  user: { id: string; name: string },
  role: "read" | "write",
): Promise<ApiResult<CollabToken>> {
  return apiFetch(
    "lore-api",
    `/api/repos/${repo}/plans/${planId}/collab-token`,
    {
      method: "POST",
      body: { user, role },
    },
  );
}

/** Writes what the author already knows into the new plan's intent, as an ordinary agent edit people then see in the document. */
export function seedPlan(
  planId: string,
  actor: string,
  paragraphs: string[],
): Promise<ApiResult<PlanDocument>> {
  return apiFetch("lore-api", `/api/plans/${planId}/agent-edits`, {
    method: "POST",
    body: {
      actor,
      ops: [{ op: "set-section-text", slot: "intent", paragraphs }],
    },
  });
}

/** Starts the planning agent's first draft of the plan, from what its author already knows. */
export function startDrafting(
  repo: string,
  planId: string,
  known: string,
  createdBy: string,
): Promise<ApiResult<{ task_id: string }>> {
  return apiFetch("lore-api", `/api/repos/${repo}/plans/${planId}/drafting`, {
    method: "POST",
    body: { known, createdBy },
  });
}

/** The editor's Refine ask for one section; lore-api answers 409 while the agent is still at work. */
export interface RefineAsk {
  slot: string;
  title: string;
  baseHash: string;
  inputs: unknown;
  uses: unknown;
}

export function askRefine(
  repo: string,
  planId: string,
  refine: RefineAsk,
): Promise<ApiResult<{ ok: true }>> {
  return apiFetch("lore-api", `/api/repos/${repo}/plans/${planId}/refine`, {
    method: "POST",
    body: refine,
  });
}
