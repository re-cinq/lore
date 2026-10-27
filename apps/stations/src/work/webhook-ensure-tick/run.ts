// Binds the weekly webhook ensure to the ports this process holds (composition root).
import { settings } from "../../outbound/queues.js";
import {
  loreApiTarget,
  postWebhookEnsure,
} from "../utopia-backfill-tick/lore-api-backfill.js";
import { webhookEnsureTick } from "./webhook-ensure-tick.js";

export const NO_LORE_API =
  "no LORE_API_URL configured: the webhook ensure runs in lore-api";

export async function runWebhookEnsureTick(): Promise<string> {
  const target = loreApiTarget();

  if (!target) {
    return NO_LORE_API;
  }

  return webhookEnsureTick({
    repos: async () =>
      (await settings().onboardedRepos()).map((repo) => repo.full_name).sort(),
    ensure: (repo) => postWebhookEnsure(target, repo),
    log: (line) => console.log(`[webhook-ensure] ${line}`),
  });
}
