import type { Octokit } from "octokit";
import {
  ensureLoreWebhook,
  type EnsureLoreWebhookResult,
} from "../webhook/webhook-ensure.js";
import { buildOctokit } from "@re-cinq/lore-shared/project/lib/platform-github-auth.js";
import {
  setRepoSecret,
  setRepoVariable,
} from "@re-cinq/lore-shared/project/lib/platform-github-repo-config.js";

/** The person's client, after it has written the repo's ingest access; undefined when no person acts, so the App keeps the work. The person's few writes skip the client-side write throttle, which would otherwise queue them seconds apart. */
export async function actingOctokit(
  fullName: string,
  env?: NodeJS.ProcessEnv,
): Promise<Octokit | undefined> {
  if (!env) {
    return undefined;
  }
  const octokit = await buildOctokit(env, { throttle: { enabled: false } });

  await setIngestAccess(fullName, octokit);

  return octokit;
}

/** Points the repo's GitHub webhook at the Lore ingress WITH the HMAC secret, best-effort. */
export async function ensuredWebhook(
  fullName: string,
  env?: NodeJS.ProcessEnv,
): Promise<EnsureLoreWebhookResult> {
  const octokit = await actingOctokit(fullName, env);
  const webhook = octokit
    ? await ensureLoreWebhook(fullName, octokit)
    : await ensureLoreWebhook(fullName);

  logWebhookOutcome(webhook, fullName);

  return webhook;
}

/** Hands the repo's workflows the ingest token (sealed secret) and URL (variable), written as the person (FR-034, FR-206). Best-effort: a refusal is logged, never fatal to the onboarding. */
async function setIngestAccess(
  fullName: string,
  octokit: Octokit,
): Promise<void> {
  try {
    await writeIngestAccess(octokit, fullName);
  } catch (err) {
    console.warn(`[onboard] ingest access for ${fullName} not set:`, err);
  }
}

async function writeIngestAccess(
  octokit: Octokit,
  fullName: string,
): Promise<void> {
  const { LORE_INGEST_URL, LORE_API_URL, LORE_INGEST_TOKEN } = process.env;
  const url = LORE_INGEST_URL || LORE_API_URL || "";

  await setRepoSecret(
    octokit,
    fullName,
    "LORE_INGEST_TOKEN",
    LORE_INGEST_TOKEN ?? "",
  );
  await setRepoVariable(octokit, fullName, "LORE_INGEST_URL", url);
}

/** Webhook wiring is best-effort — a skip is worth a warning, never a failure. */
function logWebhookOutcome(
  webhook: EnsureLoreWebhookResult,
  fullName: string,
): void {
  if (webhook.ok) {
    console.log(
      `[onboard] Webhook ${webhook.created ? "created" : "updated"} for ${fullName} (hook ${webhook.hookId})`,
    );

    return;
  }
  console.warn(
    `[onboard] Webhook not configured for ${fullName}: ${webhook.reason}${webhook.detail ? ` (${webhook.detail})` : ""}`,
  );
}
