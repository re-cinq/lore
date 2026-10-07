/** A GitHub webhook delivery turned into bus events: the signature is verified over the RAW body, then the payload is mapped. Shared by every door GitHub posts to. */

import { enforceTrue } from "../../lib/enforce.js";
import type { EventInsert } from "../../outbound/events.js";
import { mapGitHubEvent } from "../../outbound/project/events/github-map.js";
import { apiError } from "./api-error.js";
import { verifyGitHubSignature } from "./github-signature.js";
import { parseJsonBody } from "./json-body.js";

export interface GitHubDoor {
  /** The GitHub webhook secret; absent means the door is unconfigured. */
  webhookSecret?: string;
  /** The deployment a refusal names, read in GitHub's delivery log. */
  service: string;
}

/** GitHub's signature header; its presence is what marks a request as a GitHub delivery, its validity is checked by {@link eventsFromGitHubDelivery}. */
export function githubSignature(
  headers: Record<string, unknown>,
): string | undefined {
  const sig = headers["x-hub-signature-256"];

  return typeof sig === "string" ? sig : undefined;
}

/** Verify over the raw body, then map. */
export function eventsFromGitHubDelivery(
  headers: Record<string, unknown>,
  raw: string,
  signature: string,
  door: GitHubDoor,
): EventInsert[] {
  const eventType = headers["x-github-event"] as string | undefined;
  const deliveryId = (headers["x-github-delivery"] as string | undefined) ?? "";

  return mapGitHubEvent(
    enforceGitHubDelivery(eventType, raw, signature, door),
    parseJsonBody(raw, "webhook body"),
    deliveryId,
  );
}

// The three things that must hold before a GitHub body is trusted. Each error names what to fix, because these are read in a delivery log rather than at a terminal: a 500 for the missing secret (an unset env var needs a redeploy, not a redelivery), a 401 for a mismatch, a 400 for a body with no event type.
function enforceGitHubDelivery(
  eventType: string | undefined,
  raw: string,
  signature: string,
  door: GitHubDoor,
): string {
  enforceTrue(
    door.webhookSecret,
    apiError(500),
    `webhook secret not configured — set LORE_WEBHOOK_SECRET on the ${door.service} deployment`,
  );
  enforceTrue(
    verifyGitHubSignature(door.webhookSecret, signature, raw),
    apiError(401),
    "signature verification failed — LORE_WEBHOOK_SECRET and the secret on the GitHub webhook do not match",
  );
  enforceTrue(eventType, apiError(400), "missing x-github-event header");

  return eventType;
}
