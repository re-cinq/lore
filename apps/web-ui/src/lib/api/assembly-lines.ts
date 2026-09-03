import "server-only";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";

// Reads a definition from the Floor (owns the YAMLs) rather than the GENERATED builtin-definitions.ts copy, so a YAML edit shows up after a Floor deploy alone.

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

  try {
    const res = await fetch(
      `${floorUrl}/api/assembly-line-definitions/${encodeURIComponent(name)}`,
      {
        signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${token}` },
        next: { revalidate: revalidateSeconds },
      },
    );

    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as AssemblyLineDefinition;

    // The cast is a claim, not a check — confirm the fields the layout actually dereferences before trusting it.
    return isDrawable(body) ? body : null;
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
