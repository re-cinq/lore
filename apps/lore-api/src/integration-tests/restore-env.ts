import { beforeAll, afterAll } from "vitest";

/** Save all env vars in beforeAll and restore them in afterAll. */
export function restoreEnv(): void;
/** Restore env var: `undefined` means absent (delete), otherwise assign value. */
export function restoreEnv(key: string, saved: string | undefined): void;
export function restoreEnv(key?: string, saved?: string | undefined): void {
  if (key === undefined) {
    hookEnvRestore();

    return;
  }

  if (saved === undefined) {
    delete process.env[key];

    return;
  }
  process.env[key] = saved;
}

function hookEnvRestore(): void {
  let snapshot: NodeJS.ProcessEnv = {};

  beforeAll(() => {
    snapshot = { ...process.env };
  });
  afterAll(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in snapshot)) {
        delete process.env[k];
      }
    }

    for (const [k, v] of Object.entries(snapshot)) {
      if (v !== undefined) {
        process.env[k] = v;
        continue;
      }
      delete process.env[k];
    }
  });
}
