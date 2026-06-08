import type { ResolvedDarkFactorySettings } from "../../dark-factory-settings.js";
import type { SettingsPort } from "./settings-port.js";

/**
 * project.settings — resolved repo settings + repo config writes, repo bound.
 * All resolution lives in the existing resolveDarkFactorySettings behind the port.
 */
export class Settings {
  constructor(
    private readonly repo: string,
    private readonly settings: SettingsPort,
  ) {}

  resolve(): Promise<ResolvedDarkFactorySettings> {
    return this.settings.resolve(this.repo);
  }

  setRepoVariable(name: string, value: string): Promise<void> {
    return this.settings.setRepoVariable(this.repo, name, value);
  }

  setRepoSecret(name: string, value: string): Promise<void> {
    return this.settings.setRepoSecret(this.repo, name, value);
  }
}
