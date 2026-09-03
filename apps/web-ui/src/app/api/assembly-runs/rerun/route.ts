export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { serverError } from "@/lib/api-error";

// "Retry from this node" backend (specs/fork-rerun-from-node): resolves the source run's repo/blueprint server-side (client is trusted with ids, never authz facts), authorizes, then forks via POST /api/assembly-runs resume_from.
/** What the form asked to re-run: which run, which node, and optionally which visit of it. */
interface RerunRequest {
  runId: string;
  nodeId: string;
  iteration: number | undefined;
}

/** The form's fields, or the 400 explaining what is wrong with them. */
async function readRerunForm(
  req: Request,
): Promise<RerunRequest | NextResponse> {
  const form = await req.formData();
  const runId = String(form.get("run_id") ?? "");
  const nodeId = String(form.get("node_id") ?? "");
  // An empty optional field is ABSENT, not zero: the browser submits `""` for an
  // untouched input, and `Number("")` is 0, which the positive-integer check
  // below would then refuse with a 400.
  const iterationField = String(form.get("iteration") ?? "").trim();
  const iteration = iterationField === "" ? undefined : Number(iterationField);

  if (!runId || !nodeId) {
    return NextResponse.json(
      { error: "run_id and node_id are required" },
      { status: 400 },
    );
  }

  if (
    iteration !== undefined &&
    (!Number.isInteger(iteration) || iteration < 1)
  ) {
    return NextResponse.json(
      { error: "iteration must be a positive integer" },
      { status: 400 },
    );
  }

  return { runId, nodeId, iteration };
}

/** The run being forked, so its repo can be access-checked and its definition reused. A 404 upstream is a 404 here; anything else is this route failing to reach lore-api. */
async function readSourceRun(
  apiUrl: string,
  headers: Record<string, string>,
  runId: string,
): Promise<{ repo: string; blueprintName: string } | NextResponse> {
  const runRes = await fetch(
    `${apiUrl}/api/assembly-runs/${encodeURIComponent(runId)}`,
    { signal: AbortSignal.timeout(30_000), headers },
  );

  if (!runRes.ok) {
    return NextResponse.json(
      { error: `assembly run not found (${runRes.status})` },
      { status: runRes.status === 404 ? 404 : 502 },
    );
  }
  const { line } = (await runRes.json()) as {
    line: { repo: string; blueprintName: string };
  };

  return line;
}

/** Start the fork. A refusal comes back as 4xx with a reason in `error`, passed through verbatim; only a reasonless answer degrades to 502. */
async function startFork(
  apiUrl: string,
  headers: Record<string, string>,
  line: { repo: string; blueprintName: string },
  { runId, nodeId, iteration }: RerunRequest,
): Promise<NextResponse> {
  const upstream = await fetch(`${apiUrl}/api/assembly-runs`, {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      definition: line.blueprintName,
      repo: line.repo,
      resume_from: {
        run_id: runId,
        node_id: nodeId,
        ...(iteration === undefined ? {} : { iteration }),
      },
    }),
  });

  if (!upstream.ok) {
    const detail = (await upstream.json().catch(() => null)) as {
      error?: string;
    } | null;

    return NextResponse.json(
      { error: detail?.error ?? `lore-api returned ${upstream.status}` },
      { status: upstream.status < 500 ? upstream.status : 502 },
    );
  }
  const { id } = (await upstream.json()) as { id: string };

  // JSON, not a redirect — the button's fetch navigates itself; a 303 would make fetch swallow the run page as an opaque response.
  return NextResponse.json({ id });
}

export async function POST(req: Request) {
  try {
    const session = (await getServerSession(authOptions)) as {
      accessToken?: string;
    } | null;

    if (!session?.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const rerun = await readRerunForm(req);

    if (rerun instanceof Response) {
      return rerun;
    }
    const apiUrl = process.env.LORE_API_URL;
    const token = process.env.LORE_INGEST_TOKEN;

    if (!apiUrl || !token) {
      return NextResponse.json(
        { error: "LORE_API_URL/LORE_INGEST_TOKEN not configured" },
        { status: 500 },
      );
    }
    const headers = { Authorization: `Bearer ${token}` };
    const line = await readSourceRun(apiUrl, headers, rerun.runId);

    if (line instanceof Response) {
      return line;
    }

    // The fork runs against the SOURCE run's repo, so the check is on that repo
    // rather than on anything the form claimed.
    if (!(await userCanAccessRepo(session.accessToken, line.repo))) {
      return NextResponse.json(
        { error: "Access denied — you do not have access to this repo" },
        { status: 403 },
      );
    }

    return startFork(apiUrl, headers, line, rerun);
  } catch (err) {
    return serverError("assembly-run-rerun", err);
  }
}
