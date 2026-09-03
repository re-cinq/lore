import type { ResolvedDarkFactorySettings } from "../../dark-factory-settings.js";
import type { SettingsPort, RepoRecord } from "./settings-port.js";

/** Repo-bound settings; resolution delegated to SettingsPort. */
export class Settings {
  constructor(
    private readonly repo: string,
    private readonly settings: SettingsPort,
  ) {}

  resolve(): Promise<ResolvedDarkFactorySettings> {
    return this.settings.resolve(this.repo);
  }

  resolveOrNull(): Promise<ResolvedDarkFactorySettings | null> {
    return this.settings.resolveOrNull(this.repo);
  }

  setRepoVariable(name: string, value: string): Promise<void> {
    return this.settings.setRepoVariable(this.repo, name, value);
  }

  setRepoSecret(name: string, value: string): Promise<void> {
    return this.settings.setRepoSecret(this.repo, name, value);
  }

  /** The whole `lore.repos` row — the read the UI's repo pages share. */
  record(): Promise<RepoRecord | null> {
    return this.settings.record(this.repo);
  }

  rawSettings(): Promise<Record<string, unknown> | null> {
    return this.settings.rawSettings(this.repo);
  }

  updateSettings(settings: Record<string, unknown>): Promise<void> {
    return this.settings.updateSettings(this.repo, settings);
  }

  team(): Promise<string | null> {
    return this.settings.team(this.repo);
  }

  markIngested(): Promise<void> {
    return this.settings.markIngested(this.repo);
  }

  isOnboarded(): Promise<boolean> {
    return this.settings.isOnboarded(this.repo);
  }
}
