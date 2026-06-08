import type { PgPool } from "../../memory-store.js";
import {
  resolveDarkFactorySettings,
  type DarkFactorySettings,
  type ResolvedDarkFactorySettings,
} from "../../dark-factory-settings.js";
import type { SettingsPort } from "./settings-port.js";

/**
 * SettingsPort.resolve over lore.repos.settings — reads the JSONB row and runs
 * the EXISTING resolveDarkFactorySettings (no resolution logic reimplemented).
 * Repo var/secret WRITES are GitHub-config (octokit) and are wired once the
 * platform-github adapter lands.
 */
export class PgSettings implements SettingsPort {
  constructor(private readonly pool: PgPool) {}

  async resolve(repo: string): Promise<ResolvedDarkFactorySettings> {
    const { rows } = await this.pool.query("SELECT settings FROM lore.repos WHERE full_name = $1", [repo]);
    const settings = rows[0]?.settings as { dark_factory?: DarkFactorySettings } | undefined;
    return resolveDarkFactorySettings(settings?.dark_factory);
  }

  setRepoVariable(): Promise<void> {
    throw new Error("settings.setRepoVariable needs the platform-github adapter (pending)");
  }

  setRepoSecret(): Promise<void> {
    throw new Error("settings.setRepoSecret needs the platform-github adapter (pending)");
  }
}
