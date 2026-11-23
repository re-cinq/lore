import { apiFetch } from "./api/client";

/** A repository file's UTF-8 text on its default branch, read through lore-api as the signed-in person (FR-141); null when it cannot be read. */
export async function readRepoFile(
  fullName: string,
  path: string,
): Promise<string | null> {
  const result = await apiFetch<{ content: string }>(
    "lore-api",
    `/api/repos/${fullName}/github/file?path=${encodeURIComponent(path)}`,
  );

  return result.status === "ok" ? result.data.content : null;
}
