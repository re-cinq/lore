/** Pure policy auditor for the Dgraph deployment (memory-dgraph-migration AC9): given parsed K8s/Helm manifest docs, returns security-invariant violations (empty array = compliant); YAML/file reading happens at the edge, not here. */
const CRED_NAME = /password|secret|token|cred|acl/i;
const GUARDIAN = /guardian|groot|superuser/i;

type Rec = Record<string, unknown>;

const asRec = (v: unknown): Rec | undefined =>
  v !== null && typeof v === "object" ? (v as Rec) : undefined;

const str = (v: unknown): string => String(v ?? "");

function metadataOf(doc: unknown): Rec | undefined {
  return asRec(asRec(doc)?.metadata);
}

function nameOf(doc: unknown): string {
  return str(metadataOf(doc)?.name);
}

function kindOf(doc: unknown): string {
  return str(asRec(doc)?.kind);
}

function annotationsOf(doc: unknown): Rec | undefined {
  return asRec(metadataOf(doc)?.annotations);
}

function isBootstrapJob(doc: unknown): boolean {
  if (kindOf(doc) !== "Job") {
    return false;
  }
  const hook = str(annotationsOf(doc)?.["helm.sh/hook"]);

  return /pre-install/.test(hook) || /bootstrap/i.test(nameOf(doc));
}

function* flatMapEnvEntries(nodes: unknown[]): Generator<Rec> {
  for (const child of nodes) {
    yield* findEnvEntries(child);
  }
}

function* ownEnvEntries(rec: Rec): Generator<Rec> {
  const envEntries = Array.isArray(rec.env) ? rec.env : [];

  for (const envEntry of envEntries) {
    const entry = asRec(envEntry);

    if (entry) {
      yield entry;
    }
  }
}

function* nestedEnvEntries(rec: Rec): Generator<Rec> {
  for (const value of Object.values(rec)) {
    yield* findEnvEntries(value);
  }
}

function* findEnvEntries(node: unknown): Generator<Rec> {
  if (Array.isArray(node)) {
    yield* flatMapEnvEntries(node);

    return;
  }
  const rec = asRec(node);

  if (!rec) {
    return;
  }
  yield* ownEnvEntries(rec);
  yield* nestedEnvEntries(rec);
}

function* flatMapContainers(nodes: unknown[]): Generator<Rec> {
  for (const child of nodes) {
    yield* findContainers(child);
  }
}

function isContainerLike(rec: Rec): boolean {
  return Array.isArray(rec.command) || Array.isArray(rec.args);
}

function* nestedContainers(rec: Rec): Generator<Rec> {
  for (const value of Object.values(rec)) {
    yield* findContainers(value);
  }
}

function* findContainers(node: unknown): Generator<Rec> {
  if (Array.isArray(node)) {
    yield* flatMapContainers(node);

    return;
  }
  const rec = asRec(node);

  if (!rec) {
    return;
  }

  if (isContainerLike(rec)) {
    yield rec;
  }
  yield* nestedContainers(rec);
}

function containerArgv(container: Rec): string[] {
  return [
    ...((container.command as unknown[]) ?? []),
    ...((container.args as unknown[]) ?? []),
  ].map(String);
}

function isAlphaMissingAcl(container: Rec): boolean {
  const argv = containerArgv(container);

  return argv.includes("alpha") && !argv.some((arg) => arg.includes("--acl"));
}

function checkAclEnabled(doc: unknown): string[] {
  const name = nameOf(doc) || "alpha";
  const violations: string[] = [];

  for (const container of findContainers(doc)) {
    if (isAlphaMissingAcl(container)) {
      violations.push(
        `dgraph alpha (${name}) does not enable ACL: missing --acl`,
      );
    }
  }

  return violations;
}

function isHardcodedCredEntry(envEntry: Rec): boolean {
  return (
    CRED_NAME.test(str(envEntry.name)) &&
    typeof envEntry.value === "string" &&
    envEntry.value.length > 0
  );
}

function checkNoHardcodedCreds(doc: unknown): string[] {
  const where = nameOf(doc) || kindOf(doc) || "doc";
  const violations: string[] = [];

  for (const envEntry of findEnvEntries(doc)) {
    if (isHardcodedCredEntry(envEntry)) {
      violations.push(
        `hardcoded credential in env ${str(envEntry.name)} (${where}): use valueFrom.secretKeyRef / ESO, not a literal value`,
      );
    }
  }

  return violations;
}

function workloadIdentityGsa(doc: unknown): unknown {
  return annotationsOf(doc)?.["iam.gke.io/gcp-service-account"];
}

function checkWorkloadIdentity(doc: unknown): string[] {
  if (kindOf(doc) !== "ServiceAccount") {
    return [];
  }

  if (workloadIdentityGsa(doc)) {
    return [];
  }

  return [
    `ServiceAccount ${nameOf(doc) || "?"} is missing the Workload Identity annotation iam.gke.io/gcp-service-account`,
  ];
}

function isGuardianEntry(envEntry: Rec): boolean {
  const secretName = asRec(asRec(envEntry.valueFrom)?.secretKeyRef)?.name;

  return GUARDIAN.test(str(envEntry.name)) || GUARDIAN.test(str(secretName));
}

function checkGuardianIsolation(doc: unknown): string[] {
  if (isBootstrapJob(doc)) {
    return [];
  }
  const where = nameOf(doc) || kindOf(doc);
  const violations: string[] = [];

  for (const envEntry of findEnvEntries(doc)) {
    if (isGuardianEntry(envEntry)) {
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
