// What both halves of the agent-definitions routes need: the two-key ceremony gate, the pod-resource merge, and the audit writer. Here rather than in either half, because importing one from the other made a cycle.

import type { Request } from "@hapi/hapi";
import type { Pool } from "pg";
import { projectFor } from "../../../outbound/project-boot.js";
import { checkApproval, type ApprovalOutcome } from "../two-key.js";
import { z } from "zod";
import {
  skillsSourceDefault,
  skillsSourceWrite,
} from "../../../work/agents/skills-source.js";
import { skillsSourceWith } from "@re-cinq/lore-shared/agents/skills-source.js";
import type { ConfigWrite } from "@re-cinq/lore-shared/project/agents/agent-defs-port.js";
import {
  configKeysOf,
  configWithPodResources,
  type AgentPatch,
  type PodResources,
  type OwnedConfigKey,
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

/** The write being authorized: whose request, on which repo, and whether it touched the gated `image` field. */
export interface CeremonyRequest {
  request: Request;
  repo: string;
  imageTouched: boolean;
}

/** The image-touch gate, and the ceremony it produced — `gate` is null when the write never touched the gated field. */
export async function resolveCeremony({
  request,
  repo,
  imageTouched,
}: CeremonyRequest): Promise<{
  gate: ApprovalOutcome | null;
  ceremony: Ceremony;
}> {
  const gate = imageTouched
    ? await checkApproval(request, repo, ["image"], IMAGE_DETAIL)
    : null;

  return { gate, ceremony: ceremonyFrom(gate) };
}

/** Two-key when a CODEOWNER-approved PR carried the image change; plain admin otherwise. */
function ceremonyFrom(gate: ApprovalOutcome | null): Ceremony {
  return gate?.ok
    ? {
        tier: "two_key",
        pr_ref: gate.evidence.prRef,
        approver: gate.evidence.approver,
      }
    : { tier: "admin" };
}

/** Where pods fetch skills from: the value shipped agents get for ${"$"}{LORE_SKILLS_URL} at seed (seed-floor-pipelines.ts withEnvironment). */
type OwnedConfig = Pick<AgentPatch, OwnedConfigKey>;

/** A new override's config: the inherited one with the pod resources and MCP servers the create names. */
export async function createFieldsWithConfig<Fields extends { name: string }>(
  agentDefs: AgentDefsFacade,
  fields: Fields,
  owned: OwnedConfig,
): Promise<Fields> {
  if (Object.keys(configKeysOf(owned)).length === 0) {
    return fields;
  }
  const inherited = await agentDefs.resolve(fields.name);

  return {
    ...fields,
    config: configWithOwned(inherited?.config ?? null, owned),
  };
}

function configWithOwned(
  inherited: Record<string, unknown> | null,
  owned: OwnedConfig,
): Record<string, unknown> | null {
  const config = owned.pod_resources
    ? configWithPodResources(inherited, owned.pod_resources)
    : inherited;
  const withServers = owned.mcp_servers
    ? { ...config, mcp_servers: owned.mcp_servers }
    : config;

  return withAdjustedSource(withSkills(withServers, owned.skills), owned);
}

function withSkills(
  config: Record<string, unknown> | null,
  skills: string[] | null | undefined,
): Record<string, unknown> | null {
  return skills
    ? {
        ...(skillsSourceDefault()
          ? { skills_source: skillsSourceDefault() }
          : {}),
        ...config,
        skills,
      }
    : config;
}

function withAdjustedSource(
  config: Record<string, unknown> | null,
  owned: OwnedConfig,
): Record<string, unknown> | null {
  const source = config?.skills_source ?? skillsSourceDefault();
  const adjust = owned.adjust_skill_models;

  return adjust === undefined || typeof source !== "string"
    ? config
    : { ...config, skills_source: skillsSourceWith(source, { adjust }) };
}

/** What an update writes to config: pod resources merged per key over the stored ones, MCP servers as the list sent. */
export async function resolveConfigUpdate(
  agentDefs: AgentDefsFacade,
  name: string,
  owned: OwnedConfig,
): Promise<ConfigWrite | undefined> {
  const keys = configKeysOf(owned);

  if (Object.keys(keys).length === 0) {
    return undefined;
  }
  const resolved = await agentDefs.resolve(name);
  const storedConfig = resolved?.config ?? null;

  return {
    ...keys,
    ...(needsSkillsSource(keys) ? skillsSourceWrite() : {}),
    ...mergedPodResources(storedConfig, keys.podResources),
    inheritedConfig: storedConfig,
  };
}

function needsSkillsSource(keys: ReturnType<typeof configKeysOf>): boolean {
  return Boolean(keys.skills?.length) || keys.adjustSkillModels !== undefined;
}

function mergedPodResources(
  storedConfig: Record<string, unknown> | null,
  patch: PodResources | null | undefined,
): Pick<ConfigWrite, "podResources"> {
  if (patch === undefined) {
    return {};
  }
  const stored = storedConfig?.pod_resources as PodResources | null | undefined;

  return { podResources: patchPodResources(stored, patch) };
}

function patchPodResources(
  stored: PodResources | null | undefined,
  patch: PodResources | null,
): PodResources | null {
  return patch !== null && stored
    ? mergePodResourcesSubKeys(stored, patch)
    : patch;
}

function mergePodResourcesSubKeys(
  stored: PodResources,
  patch: PodResources,
): PodResources {
  const result: PodResources = {};
  const mergedLimits = { ...stored.limits, ...patch.limits };
  const mergedRequests = { ...stored.requests, ...patch.requests };

  if (Object.keys(mergedLimits).length > 0) {
    result.limits = mergedLimits;
  }

  if (Object.keys(mergedRequests).length > 0) {
    result.requests = mergedRequests;
  }

  return result;
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
