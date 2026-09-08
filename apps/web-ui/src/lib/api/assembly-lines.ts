import "server-only";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";

// Reads a definition from the Floor, which owns the YAMLs, so a YAML edit shows up after a Floor deploy alone and web-ui carries no copy to rot.

/** Never throws — an unreachable or unconfigured Floor yields null and the caller renders nothing. */
export async function getAssemblyLineDefinition(
  name: string,
  revalidateSeconds = 300,
): Promise<AssemblyLineDefinition | null> {
  const floorUrl = process.env.LORE_FLOOR_URL;
  const token = process.env.LORE_INGEST_TOKEN;

  if (!floorUrl || !token) {
    return null;
  }

  const body = await fetchDefinition(floorUrl, token, name, revalidateSeconds);

  // The cast is a claim, not a check — confirm the fields the layout actually dereferences before trusting it.
  return isDrawable(body) ? body : null;
}

async function fetchDefinition(
  floorUrl: string,
  token: string,
  name: string,
  revalidateSeconds: number,
): Promise<AssemblyLineDefinition | null> {
  try {
    const res = await fetch(
      `${floorUrl}/api/assembly-line-definitions/${encodeURIComponent(name)}`,
      {
        signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${token}` },
        next: { revalidate: revalidateSeconds },
      },
    );

    return res.ok ? ((await res.json()) as AssemblyLineDefinition) : null;
  } catch {
    return null;
  }
}

/** Everything the graph layout dereferences. */
function isDrawable(body: AssemblyLineDefinition | null): boolean {
  return (
    !!body &&
    typeof body.name === "string" &&
    typeof body.entry === "string" &&
    Array.isArray(body.edges) &&
    Array.isArray(body.nodes) &&
    body.nodes.length > 0
  );
}
