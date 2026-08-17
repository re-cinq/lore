import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function getUserRepos(accessToken: string): Promise<string[]> {
  try {
    const res = await fetch(
      "https://api.github.com/user/repos?per_page=100&sort=updated",
      {
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const repos = await res.json();

    return repos.map((r: { full_name: string }) => r.full_name);
  } catch {
    return [];
  }
}
