// The repositories read beside a repository: those publishing the organisation packages it depends on, and those it links when cross-repo context is on.

import {
  orgDependencies,
  resolveDependency,
} from "@re-cinq/lore-shared/context-builder/dependency-repos.js";

export interface RelatedRepoReaders {
  manifests(): Promise<string[]>;
  registryRepository(packageName: string): Promise<string | null>;
  onboarded(): Promise<string[]>;
  linked: string[];
}

export async function relatedRepos(
  repo: string,
  readers: RelatedRepoReaders,
): Promise<string[]> {
  const scope = `@${repo.split("/")[0].toLowerCase()}`;
  const [manifests, onboarded] = await Promise.all([
    readers.manifests(),
    readers.onboarded(),
  ]);
  const resolved = await Promise.all(
    orgDependencies(scope, manifests).map(async (dependency) =>
      resolveDependency(dependency, {
        registryRepository: await readers.registryRepository(dependency.name),
        onboarded,
      }),
    ),
  );
  const named = [...resolved, ...readers.linked].filter(
    (other): other is string => other !== null && !sameRepo(other, repo),
  );

  return [
    ...new Map(named.map((other) => [other.toLowerCase(), other])).values(),
  ];
}

function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
