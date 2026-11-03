// The repositories a repository depends on: its organisation's packages, each resolved through its git URL, the registry's repository field, or an onboarded repository of the same name.

export interface OrgDependency {
  name: string;
  spec: string;
}

export interface DependencyClues {
  registryRepository: string | null;
  onboarded: string[];
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
];
const GITHUB_REPO_RE =
  /(?:github:|github\.com[/:])([\w.-]+\/[\w.-]+?)(?:\.git)?(?:#|$)/;

export function orgDependencies(
  scope: string,
  manifests: string[],
): OrgDependency[] {
  const entries = manifests
    .flatMap(dependencyEntries)
    .filter(([name]) => name.startsWith(`${scope}/`));
  const isFirstOfName = ([name]: [string, string], index: number) =>
    entries.findIndex(([other]) => other === name) === index;

  return entries.filter(isFirstOfName).map(([name, spec]) => ({ name, spec }));
}

export function resolveDependency(
  dependency: OrgDependency,
  clues: DependencyClues,
): string | null {
  return (
    githubRepo(dependency.spec) ??
    githubRepo(clues.registryRepository ?? "") ??
    onboardedNamed(dependency.name, clues.onboarded)
  );
}

function dependencyEntries(manifest: string): [string, string][] {
  const parsed = parseObject(manifest);

  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries(parseObject(parsed[field])).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function parseObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? safeParse(value) : value;

  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function githubRepo(reference: string): string | null {
  return GITHUB_REPO_RE.exec(reference)?.[1] ?? null;
}

function onboardedNamed(
  packageName: string,
  onboarded: string[],
): string | null {
  const wanted = squash(packageName.split("/").pop() ?? "");

  return (
    onboarded.find((repo) => squash(repo.split("/")[1]) === wanted) ?? null
  );
}

function squash(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
