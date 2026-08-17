import "server-only";
import type { AssemblyLineDefinition } from "@/lib/assembly-line-definition";

// Read an assembly-line definition from the Floor, which owns the YAMLs.
//
// web-ui also carries a GENERATED copy (builtin-definitions.ts) for the run-detail
// view, but a copy only changes when web-ui is rebuilt. Fetching means a YAML edit
// shows up after a Floor deploy alone — which is the actual requirement: the
// planning pages must describe the machine that will really run.

/** Never throws. A preview is worth less than the page it sits on, so an
 *  unreachable or unconfigured Floor yields null and the caller renders nothing. */
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
      { signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${token}` },
        next: { revalidate: revalidateSeconds },
      },
    );

    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as AssemblyLineDefinition;

    // The cast is a claim, not a check. An error envelope or a truncated payload
    // would otherwise reach the layout code as a shape it does not expect, so
    // confirm the fields it actually dereferences: the graph, and the entry the
    // layout roots on.
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
