import type { ResolvedDarkFactorySettings } from "../../dark-factory-settings.js";

/**
 * Repo settings port. resolve() returns the fully-resolved lore.repos.settings
 * (the settings-pg adapter reads the row then calls the existing
 * resolveDarkFactorySettings — no new resolution logic). Repo config writes
 * (GitHub vars/secrets) round out the surface.
 */
export interface SettingsPort {
  resolve(repo: string): Promise<ResolvedDarkFactorySettings>;
  /** Resolved settings, or null when the repo is not onboarded (no lore.repos row). */
  resolveOrNull(repo: string): Promise<ResolvedDarkFactorySettings | null>;
  setRepoVariable(repo: string, name: string, value: string): Promise<void>;
  setRepoSecret(repo: string, name: string, value: string): Promise<void>;
}
