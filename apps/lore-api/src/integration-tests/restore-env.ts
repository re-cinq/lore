/** Put an env var back the way a test found it: a saved `undefined` means the
 *  variable was absent, and assigning `undefined` would store the string
 *  "undefined" — so absence is restored by deletion. */
export function restoreEnv(key: string, saved: string | undefined): void {
  if (saved === undefined) {
    delete process.env[key];

    return;
  }
  process.env[key] = saved;
}
