/** djb2 — deterministic across runs and runtime-independent: the hash every stable id in Lore is keyed on. */
export function djb2Hash(str: string): string {
  let hash = 5381;

  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }

  return (hash >>> 0).toString(16);
}
