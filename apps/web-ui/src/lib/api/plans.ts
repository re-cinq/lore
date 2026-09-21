import "server-only";
import type { PlanDocument, PlanKind, PlanMeta } from "@re-cinq/planning-document";
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

export function approvePlan(
  planId: string,
  approvedBy: string,
): Promise<ApiResult<PlanMeta>> {
  return apiFetch("lore-api", `/api/plans/${planId}/approve`, {
    method: "POST",
    body: { approvedBy },
  });
}

/** A short-lived token that opens the plan's socket as this person; the caller has already checked their access to the repo. */
export function mintCollabToken(
  repo: string,
  planId: string,
  user: { id: string; name: string },
  role: "read" | "write",
): Promise<ApiResult<CollabToken>> {
  return apiFetch("lore-api", `/api/repos/${repo}/plans/${planId}/collab-token`, {
    method: "POST",
    body: { user, role },
  });
}

/** Writes what the author already knows into the new plan's intent, as an ordinary agent edit people then see in the document. */
export function seedPlan(
  planId: string,
  actor: string,
  paragraphs: string[],
): Promise<ApiResult<PlanDocument>> {
  return apiFetch("lore-api", `/api/plans/${planId}/agent-edits`, {
    method: "POST",
    body: { actor, ops: [{ op: "set-section-text", slot: "intent", paragraphs }] },
  });
}
