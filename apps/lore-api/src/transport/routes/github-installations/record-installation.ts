import type { z } from "zod";
import { toRow } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  GithubInstallationSchema,
  GITHUB_INSTALLATION_COLUMNS,
} from "@re-cinq/lore-shared/models/github-installation.js";
import { installationFromGithub } from "@re-cinq/lore-shared/github-installation/installation-from-github.js";
import type { GithubApp } from "@re-cinq/lore-shared/project/github-installations/github-app-port.js";
import type { GithubInstallationsRepository } from "@re-cinq/lore-shared/project/github-installations/github-installations-port.js";

/** One lore.github_installations row on the wire, derived from the model so the contract and the table cannot drift. */
export const GithubInstallationWire = wireSchema(
  GithubInstallationSchema,
  GITHUB_INSTALLATION_COLUMNS,
);

/** What recording an installation needs: GitHub as the App sees it, and the registry the installation lands in. */
export interface RecordInstallationDeps {
  app: GithubApp;
  installations: GithubInstallationsRepository;
}

/** The recorded installation, or the 404 for an id GitHub does not know as one of this App's installations. */
export type RecordInstallationResult =
  | { code: 200; body: z.infer<typeof GithubInstallationWire> }
  | { code: 404; body: { error: "not-an-installation-of-this-app" } };

/** Records the installation GitHub redirected an admin back with (specs/4-ux-repo-onboarding FR-8) — only after GitHub, asked as the App, confirms the id is one of this App's installations; an id in a redirect is not evidence on its own. */
export async function handleRecordInstallation(
  deps: RecordInstallationDeps,
  body: { installation_id: number },
): Promise<RecordInstallationResult> {
  const payload = await deps.app.getInstallation(body.installation_id);

  if (!payload) {
    return { code: 404, body: { error: "not-an-installation-of-this-app" } };
  }
  const recorded = await deps.installations.upsert(
    installationFromGithub(payload),
  );

  return {
    code: 200,
    body: GithubInstallationWire.parse(
      toRow(GITHUB_INSTALLATION_COLUMNS, recorded),
    ),
  };
}
