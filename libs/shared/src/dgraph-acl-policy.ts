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

type Rec = Record<string, unknown>;

const asRec = (v: unknown): Rec | undefined =>
  v !== null && typeof v === "object" ? (v as Rec) : undefined;

const str = (v: unknown): string => String(v ?? "");

function isBootstrapJob(doc: unknown): boolean {
  const d = asRec(doc);
  const meta = asRec(d?.metadata);
  const ann = asRec(meta?.annotations);

  return (
    d?.kind === "Job" &&
    (/pre-install/.test(str(ann?.["helm.sh/hook"])) ||
      /bootstrap/i.test(str(meta?.name)))
  );
}

function* findEnvEntries(node: unknown): Generator<Rec> {
  if (Array.isArray(node)) {
    for (const child of node) {
      yield* findEnvEntries(child);
    }

    return;
  }
  const rec = asRec(node);

  if (!rec) {
    return;
  }
  const envEntries = Array.isArray(rec.env) ? rec.env : [];

  for (const envEntry of envEntries) {
    const entry = asRec(envEntry);

    if (entry) {
      yield entry;
    }
  }

  for (const value of Object.values(rec)) {
    yield* findEnvEntries(value);
  }
}

function* findContainers(node: unknown): Generator<Rec> {
  if (Array.isArray(node)) {
    for (const child of node) {
      yield* findContainers(child);
    }

    return;
  }
  const rec = asRec(node);

  if (!rec) {
    return;
  }

  if (Array.isArray(rec.command) || Array.isArray(rec.args)) {
    yield rec;
  }

  for (const value of Object.values(rec)) {
    yield* findContainers(value);
  }
}

function checkAclEnabled(doc: unknown): string[] {
  const violations: string[] = [];
  const name = str(asRec(asRec(doc)?.metadata)?.name) || "alpha";

  for (const container of findContainers(doc)) {
    const argv = [
      ...((container.command as unknown[]) ?? []),
      ...((container.args as unknown[]) ?? []),
    ].map(String);

    if (argv.includes("alpha") && !argv.some((arg) => arg.includes("--acl"))) {
      violations.push(
        `dgraph alpha (${name}) does not enable ACL: missing --acl`,
      );
    }
  }

  return violations;
}

function checkNoHardcodedCreds(doc: unknown): string[] {
  const violations: string[] = [];
  const meta = asRec(asRec(doc)?.metadata);
  const where = str(meta?.name) || str(asRec(doc)?.kind) || "doc";

  for (const envEntry of findEnvEntries(doc)) {
    if (
      CRED_NAME.test(str(envEntry.name)) &&
      typeof envEntry.value === "string" &&
      envEntry.value.length > 0
    ) {
      violations.push(
        `hardcoded credential in env ${str(envEntry.name)} (${where}): use valueFrom.secretKeyRef / ESO, not a literal value`,
      );
    }
  }

  return violations;
}

function checkWorkloadIdentity(doc: unknown): string[] {
  const meta = asRec(asRec(doc)?.metadata);

  if (asRec(doc)?.kind !== "ServiceAccount") {
    return [];
  }
  const gsa = asRec(meta?.annotations)?.["iam.gke.io/gcp-service-account"];

  if (gsa) {
    return [];
  }

  return [
    `ServiceAccount ${str(meta?.name) || "?"} is missing the Workload Identity annotation iam.gke.io/gcp-service-account`,
  ];
}

function checkGuardianIsolation(doc: unknown): string[] {
  if (isBootstrapJob(doc)) {
    return [];
  }
  const violations: string[] = [];
  const meta = asRec(asRec(doc)?.metadata);
  const where = str(meta?.name) || str(asRec(doc)?.kind);

  for (const envEntry of findEnvEntries(doc)) {
    const secretName = asRec(asRec(envEntry.valueFrom)?.secretKeyRef)?.name;

    if (GUARDIAN.test(str(envEntry.name)) || GUARDIAN.test(str(secretName))) {
      violations.push(
        `guardian credential referenced in runtime workload ${where}: the guardian credential must be used only by the pre-install bootstrap Job`,
      );
    }
  }

  return violations;
}

const CHECKS = [
  checkAclEnabled,
  checkNoHardcodedCreds,
  checkWorkloadIdentity,
  checkGuardianIsolation,
];

export function auditDgraphAcl(docs: Array<Record<string, unknown>>): string[] {
  return docs.flatMap((doc) => CHECKS.flatMap((check) => check(doc)));
}
