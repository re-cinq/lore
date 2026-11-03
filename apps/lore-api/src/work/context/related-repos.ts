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
  const [owner] = repo.split("/");
  const published = await publishingRepos(`@${owner.toLowerCase()}`, readers);

  return distinctOthers(repo, [...published, ...readers.linked]);
}

async function publishingRepos(
  scope: string,
  readers: RelatedRepoReaders,
): Promise<(string | null)[]> {
  const [manifests, onboarded] = await Promise.all([
    readers.manifests(),
    readers.onboarded(),
  ]);

  return Promise.all(
    orgDependencies(scope, manifests).map(async (dependency) =>
      resolveDependency(dependency, {
        registryRepository: await readers.registryRepository(dependency.name),
        onboarded,
      }),
    ),
  );
}

function distinctOthers(repo: string, names: (string | null)[]): string[] {
  const others = names.filter(
    (name): name is string =>
      name !== null && name.toLowerCase() !== repo.toLowerCase(),
  );

  return [
    ...new Map(others.map((name) => [name.toLowerCase(), name])).values(),
  ];
}
