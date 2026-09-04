export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { userCanAccessRepo } from "@/lib/user-repo-access";
import { resolveSessionAccessToken } from "@/lib/session-access-token";
import { resolveLoreApiConfig } from "@/lib/lore-api-config";
import { serverError } from "@/lib/api-error";

// "Retry from this node" backend (specs/fork-rerun-from-node): resolves the source run's repo/blueprint server-side (client is trusted with ids, never authz facts), authorizes, then forks via POST /api/assembly-runs resume_from.
/** What the form asked to re-run: which run, which node, and optionally which visit of it. */
interface RerunRequest {
  runId: string;
  nodeId: string;
  iteration: number | undefined;
}

function formField(form: FormData, name: string): string {
  return String(form.get(name) ?? "");
}

// Empty field → undefined not 0: Number("") is 0 but should fail the positive-integer check below.
function parseIteration(field: string): number | undefined {
  const trimmed = field.trim();

  return trimmed === "" ? undefined : Number(trimmed);
}

function iterationError(iteration: number | undefined): NextResponse | null {
  if (
    iteration === undefined ||
    (Number.isInteger(iteration) && iteration >= 1)
  ) {
    return null;
  }

  return NextResponse.json(
    { error: "iteration must be a positive integer" },
    { status: 400 },
  );
}

/** The form's fields, or the 400 explaining what is wrong with them. */
async function readRerunForm(
  req: Request,
): Promise<RerunRequest | NextResponse> {
  const form = await req.formData();
  const runId = formField(form, "run_id");
  const nodeId = formField(form, "node_id");
  const iteration = parseIteration(formField(form, "iteration"));

  if (!runId || !nodeId) {
    return NextResponse.json(
      { error: "run_id and node_id are required" },
      { status: 400 },
    );
  }

  const badIteration = iterationError(iteration);

  if (badIteration) {
    return badIteration;
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

/** Resolves the source run, then authorizes against ITS repo (not form input). */
async function readAuthorizedSourceRun(
  apiUrl: string,
  headers: Record<string, string>,
  accessToken: string,
  runId: string,
): Promise<{ repo: string; blueprintName: string } | NextResponse> {
  const line = await readSourceRun(apiUrl, headers, runId);

  if (line instanceof Response) {
    return line;
  }

  if (!(await userCanAccessRepo(accessToken, line.repo))) {
    return NextResponse.json(
      { error: "Access denied — you do not have access to this repo" },
      { status: 403 },
    );
  }

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
    const accessToken = await resolveSessionAccessToken();

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const rerun = await readRerunForm(req);

    if (rerun instanceof Response) {
      return rerun;
    }
    const apiConfig = resolveLoreApiConfig();

    if (!apiConfig) {
      return NextResponse.json(
        { error: "LORE_API_URL/LORE_INGEST_TOKEN not configured" },
        { status: 500 },
      );
    }
    const { apiUrl, token } = apiConfig;
    const headers = { Authorization: `Bearer ${token}` };
    const line = await readAuthorizedSourceRun(
      apiUrl,
      headers,
      accessToken,
      rerun.runId,
    );

    if (line instanceof Response) {
      return line;
    }

    return startFork(apiUrl, headers, line, rerun);
  } catch (err) {
    return serverError("assembly-run-rerun", err);
  }
}
