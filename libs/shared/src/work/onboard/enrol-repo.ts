// Enrolling a repository: its dispatch labels, the ingest callback, and the verbatim scaffolding on the onboarding branch. Everything that could not be done is audited and handed back as the "needs attention" section, so the caller decides where a person reads it.

import {
  anyWorkflowsPermissionFailure,
  onboardAttentionSection,
} from "./onboard-attention.js";
import {
  auditOnboardFailuresIfAny,
  createDispatchLabels,
  type AuditWriter,
  type LabelIssues,
} from "./onboard-audit.js";
import {
  configureIngestCallback,
  logIngestConfigResult,
  type IngestCallbackSettings,
} from "./onboard-ingest-callback.js";
import { commitOnboardScaffold, type ScaffoldRepo } from "./onboard-scaffold.js";

export interface EnrolRepoDeps {
  repo: ScaffoldRepo;
  settings: IngestCallbackSettings;
  issues: LabelIssues;
  audit: AuditWriter;
}

export interface EnrolTarget {
  repo: string;
  /** The onboarding branch, which must already exist. */
  branch: string;
  taskId: string;
}

export interface Enrolment {
  committed: string[];
  /** The "needs attention" markdown, or "" when enrolment left no gap. */
  attention: string;
}

export async function enrolRepo(
  deps: EnrolRepoDeps,
  target: EnrolTarget,
): Promise<Enrolment> {
  await createDispatchLabels(deps.issues, target.repo);
  const configFailures = await configureIngestCallback(deps.settings);

  logIngestConfigResult(target.repo, configFailures);
  const { committed, failures } = await commitOnboardScaffold(
    deps.repo,
    target.branch,
  );
  const gaps = {
    failures,
    configFailures,
    workflowsPermissionDenied: anyWorkflowsPermissionFailure(failures),
  };

  await auditOnboardFailuresIfAny(
    { taskId: target.taskId, targetRepo: target.repo, ...gaps },
    deps.audit,
  );

  return { committed, attention: onboardAttentionSection(gaps) };
}
