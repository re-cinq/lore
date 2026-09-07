// What both halves of the agent-definitions routes need: the two-key ceremony gate, the pod-resource merge, and the audit writer. Here rather than in either half, because importing one from the other made a cycle.

import type { Request } from "@hapi/hapi";
import type { Pool } from "pg";
import { projectFor } from "../../../outbound/project-boot.js";
import { checkApproval, type ApprovalOutcome } from "../two-key.js";
import { z } from "zod";
import type { PodResourcesWrite } from "@re-cinq/lore-shared/project/agents/agent-defs-port.js";
import {
  parseAgentInput,
  parseAgentPatch,
  configWithPodResources,
} from "../../../work/agents/agents-schema.js";

/** The definitions surface of one repo's project facade — the thing every write here goes through. */
type AgentDefsFacade = Awaited<ReturnType<typeof projectFor>>["agentDefs"];

export const repoOf = (params: Record<string, string>) =>
  `${params.owner}/${params.repo}`;

/** The ceremony that authorised a write — `two_key` when the image was touched. */
export const CeremonySchema = z.object({
  tier: z.enum(["two_key", "admin"]),
  pr_ref: z.string().optional(),
  approver: z.string().optional(),
});

export const IMAGE_DETAIL =
  "Changing an agent's execution image requires an X-Lore-Approval-PR header. " +
  "Reference an open PR labeled `dark-factory-approval` by a CODEOWNER.";

export type Ceremony = {
  tier: "two_key" | "admin";
  pr_ref?: string;
  approver?: string;
};

/** The image-touch gate, and the ceremony it produced — `gate` is null when the write never touched the gated field. */
export async function resolveCeremony(
  request: Request,
  repo: string,
  imageTouched: boolean,
): Promise<{ gate: ApprovalOutcome | null; ceremony: Ceremony }> {
  const gate = imageTouched
    ? await checkApproval(request, repo, ["image"], IMAGE_DETAIL)
    : null;

  const ceremony: Ceremony = gate?.ok
    ? {
        tier: "two_key",
        pr_ref: gate.evidence.prRef,
        approver: gate.evidence.approver,
      }
    : { tier: "admin" };

  return { gate, ceremony };
}

export async function createFieldsWithPodResources(
  agentDefs: AgentDefsFacade,
  fields: Omit<ReturnType<typeof parseAgentInput>, "pod_resources">,
  podResources: ReturnType<typeof parseAgentInput>["pod_resources"],
): Promise<typeof fields> {
  if (!podResources) {
    return fields;
  }
  const inherited = await agentDefs.resolve(fields.name);

  return {
    ...fields,
    config: configWithPodResources(inherited?.config ?? null, podResources),
  };
}

export async function resolvePodResourcesUpdate(
  agentDefs: AgentDefsFacade,
  name: string,
  podResources: ReturnType<typeof parseAgentPatch>["pod_resources"],
): Promise<PodResourcesWrite | undefined> {
  if (podResources === undefined) {
    return undefined;
  }

  return {
    podResources,
    inheritedConfig: (await agentDefs.resolve(name))?.config ?? null,
  };
}

export function issuesOf(err: unknown): unknown {
  return typeof err === "object" && err !== null && "issues" in err
    ? (err as { issues: unknown }).issues
    : (err as Error).message;
}

export async function audit(
  pool: Pool,
  repo: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  await pool
    .query(
      `INSERT INTO pipeline.audit_log (event_type, repo, payload) VALUES ($1, $2, $3)`,
      [eventType, repo, JSON.stringify(payload)],
    )
    .catch(() => {
      // Audit log is best-effort; never block the write.
    });
}
