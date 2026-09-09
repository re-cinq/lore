/** Restore env var: `undefined` means absent (delete), otherwise assign value. */
export function restoreEnv(key: string, saved: string | undefined): void {
  if (saved === undefined) {
    delete process.env[key];

    return;
  }
  process.env[key] = saved;
}
