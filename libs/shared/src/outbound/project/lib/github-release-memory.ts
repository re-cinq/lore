import { enforceTrue } from "../../../lib/enforce.js";
import type {
  GitHubReleasePort,
  ReleaseEdit,
  ReleaseInput,
  ReleaseRecord,
} from "./github-port.js";

export class InMemoryGitHubReleases implements GitHubReleasePort {
  private readonly tags = new Map<string, string>();
  private readonly releases = new Map<string, ReleaseRecord>();
  private readonly variables = new Map<string, string>();
  private nextReleaseId = 1;

  async createTagRef(repo: string, tag: string, sha: string): Promise<void> {
    const key = `${repo}#${tag}`;

    enforceTrue(
      !this.tags.has(key),
      Error,
      `tag ${tag} already exists in ${repo}`,
    );
    this.tags.set(key, sha);
  }

  async createRelease(
    repo: string,
    input: ReleaseInput,
  ): Promise<ReleaseRecord> {
    const key = `${repo}#${input.tag}`;

    enforceTrue(
      !this.releases.has(key),
      Error,
      `release for tag ${input.tag} already exists in ${repo}`,
    );
    const record = this.recordOf(repo, input);

    this.releases.set(key, record);

    return record;
  }

  private recordOf(repo: string, input: ReleaseInput): ReleaseRecord {
    return {
      id: this.nextReleaseId++,
      tag: input.tag,
      name: input.name,
      body: input.body,
      draft: input.draft ?? false,
      url: `https://github.com/${repo}/releases/tag/${input.tag}`,
    };
  }

  async releaseByTag(repo: string, tag: string): Promise<ReleaseRecord | null> {
    return this.releases.get(`${repo}#${tag}`) ?? null;
  }

  async updateRelease(
    repo: string,
    id: number,
    edit: ReleaseEdit,
  ): Promise<ReleaseRecord> {
    const existing = [...this.releases.entries()].find(
      ([key, release]) => key.startsWith(`${repo}#`) && release.id === id,
    );

    enforceTrue(existing, Error, `no release ${id} in ${repo}`);
    const [key, release] = existing;
    const updated = { ...release, ...edit };

    this.releases.set(key, updated);

    return updated;
  }

  async repoVariable(repo: string, name: string): Promise<string | null> {
    return this.variables.get(`${repo}#${name}`) ?? null;
  }

  seedVariable(repo: string, name: string, value: string): void {
    this.variables.set(`${repo}#${name}`, value);
  }

  tagsOf(repo: string): Record<string, string> {
    return Object.fromEntries(
      [...this.tags.entries()]
        .filter(([key]) => key.startsWith(`${repo}#`))
        .map(([key, sha]) => [key.slice(repo.length + 1), sha]),
    );
  }
}
