import type { z } from "zod";
import { toRow } from "@re-cinq/lore-shared/lib/row.js";
import { GITHUB_INSTALLATION_COLUMNS } from "@re-cinq/lore-shared/models/github-installation.js";
import type { GithubInstallationsRepository } from "@re-cinq/lore-shared/project/github-installations/github-installations-port.js";
import { GithubInstallationWire } from "./record-installation.js";

/** The accounts Lore is connected to (specs/4-ux-repo-onboarding FR-8), each in its wire shape, ordered by account login — what the Connect GitHub page shows. */
export async function handleListInstallations(deps: {
  installations: GithubInstallationsRepository;
}): Promise<{ code: 200; body: z.infer<typeof GithubInstallationWire>[] }> {
  const installations = await deps.installations.list();

  return {
    code: 200,
    body: installations.map((installation) =>
      GithubInstallationWire.parse(
        toRow(GITHUB_INSTALLATION_COLUMNS, installation),
      ),
    ),
  };
}
