import type { PgPool } from "../../memory-store.js";
import {
  resolveDarkFactorySettings,
  type DarkFactorySettings,
  type ResolvedDarkFactorySettings,
} from "../../dark-factory-settings.js";
import type { SettingsPort } from "./settings-port.js";

/** The repo-config writes the settings adapter delegates to (the GitHub adapter). */
export interface RepoConfigWriter {
  setRepoVariable(repo: string, name: string, value: string): Promise<void>;
  setRepoSecret(repo: string, name: string, value: string): Promise<void>;
}

/**
 * SettingsPort.resolve over lore.repos.settings — reads the JSONB row and runs
 * the EXISTING resolveDarkFactorySettings (no resolution logic reimplemented).
 * Repo var/secret WRITES are GitHub-config, delegated to the injected writer
 * (the platform-github adapter).
 */
export class PgSettings implements SettingsPort {
  constructor(
    private readonly pool: PgPool,
    private readonly repoConfig: RepoConfigWriter,
  ) {}

  async resolve(repo: string): Promise<ResolvedDarkFactorySettings> {
    const { rows } = await this.pool.query("SELECT settings FROM lore.repos WHERE full_name = $1", [repo]);
    const settings = rows[0]?.settings as { dark_factory?: DarkFactorySettings } | undefined;
    return resolveDarkFactorySettings(settings?.dark_factory);
  }

  setRepoVariable(repo: string, name: string, value: string): Promise<void> {
    return this.repoConfig.setRepoVariable(repo, name, value);
  }

  setRepoSecret(repo: string, name: string, value: string): Promise<void> {
    return this.repoConfig.setRepoSecret(repo, name, value);
  }
}
