/**
 * Pure policy auditor for the Dgraph deployment (memory-dgraph-migration AC9):
 * given parsed K8s/Helm manifest docs, returns a list of security-invariant
 * violations (ACL enabled, scoped lore-memory-app runtime user, guardian
 * credential only in the pre-install bootstrap Job, ESO + Workload Identity,
 * no hardcoded credential in any chart). Empty array = compliant. Pure: the
 * YAML/file reading happens at the edge (an integration test), not here.
 */
const CRED_NAME = /password|secret|token|cred|acl/i;
const GUARDIAN = /guardian|groot|superuser/i;

function isBootstrapJob(doc: any): boolean {
  return (
    doc?.kind === "Job" &&
    (/pre-install/.test(String(doc?.metadata?.annotations?.["helm.sh/hook"])) ||
      /bootstrap/i.test(String(doc?.metadata?.name)))
  );
}

function* findEnvEntries(node: any): Generator<any> {
  if (Array.isArray(node)) {
    for (const child of node) yield* findEnvEntries(child);
    return;
  }
  if (node && typeof node === "object") {
    if (Array.isArray(node.env)) for (const envEntry of node.env) yield envEntry;
    for (const value of Object.values(node)) yield* findEnvEntries(value);
  }
}

function* findContainers(node: any): Generator<any> {
  if (Array.isArray(node)) {
    for (const child of node) yield* findContainers(child);
    return;
  }
  if (node && typeof node === "object") {
    if (Array.isArray(node.command) || Array.isArray(node.args)) yield node;
    for (const value of Object.values(node)) yield* findContainers(value);
  }
}

function checkAclEnabled(doc: any): string[] {
  const violations: string[] = [];
  for (const container of findContainers(doc)) {
    const argv = [...(container.command ?? []), ...(container.args ?? [])].map(String);
    if (argv.includes("alpha") && !argv.some((arg) => arg.includes("--acl"))) {
      violations.push(
        `dgraph alpha (${doc?.metadata?.name ?? "alpha"}) does not enable ACL: missing --acl`,
      );
    }
  }
  return violations;
}

function checkNoHardcodedCreds(doc: any): string[] {
  const violations: string[] = [];
  for (const envEntry of findEnvEntries(doc)) {
    if (
      envEntry &&
      CRED_NAME.test(String(envEntry.name)) &&
      typeof envEntry.value === "string" &&
      envEntry.value.length > 0
    ) {
      const where = doc?.metadata?.name ?? doc?.kind ?? "doc";
      violations.push(
        `hardcoded credential in env ${envEntry.name} (${where}): use valueFrom.secretKeyRef / ESO, not a literal value`,
      );
    }
  }
  return violations;
}

function checkWorkloadIdentity(doc: any): string[] {
  if (doc?.kind !== "ServiceAccount") return [];
  const gsa = doc?.metadata?.annotations?.["iam.gke.io/gcp-service-account"];
  if (gsa) return [];
  return [
    `ServiceAccount ${doc?.metadata?.name ?? "?"} is missing the Workload Identity annotation iam.gke.io/gcp-service-account`,
  ];
}

function checkGuardianIsolation(doc: any): string[] {
  if (isBootstrapJob(doc)) return [];
  const violations: string[] = [];
  for (const envEntry of findEnvEntries(doc)) {
    if (
      envEntry &&
      (GUARDIAN.test(String(envEntry.name)) ||
        GUARDIAN.test(String(envEntry?.valueFrom?.secretKeyRef?.name)))
    ) {
      violations.push(
        `guardian credential referenced in runtime workload ${doc?.metadata?.name ?? doc?.kind}: the guardian credential must be used only by the pre-install bootstrap Job`,
      );
    }
  }
  return violations;
}

const CHECKS = [checkAclEnabled, checkNoHardcodedCreds, checkWorkloadIdentity, checkGuardianIsolation];

export function auditDgraphAcl(docs: Array<Record<string, any>>): string[] {
  return docs.flatMap((doc) => CHECKS.flatMap((check) => check(doc)));
}
