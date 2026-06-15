import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

export async function getSession() {
  return getServerSession(authOptions);
}

export async function getUserRepos(accessToken: string): Promise<string[]> {
  try {
    const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const repos = await res.json();
    return repos.map((r: any) => r.full_name);
  } catch {
    return [];
  }
}
