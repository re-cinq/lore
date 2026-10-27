// The weekly webhook ensure (specs/external-floor FR12.19c): every onboarded repo through lore-api's ensure route, so a repo onboarded before an event was required (check_suite, 2026-10-23) still delivers it. Onboarding ensures the webhook once; this heals the drift.
import {
  askFor,
  counted,
  refusedLine,
  type RepoAnswer,
} from "../lib/repo-sweep.js";

export type EnsureAnswer = RepoAnswer;

export interface WebhookEnsureTickDeps {
  repos: () => Promise<string[]>;
  ensure: (repo: string) => Promise<EnsureAnswer>;
  log: (line: string) => void;
}

export const NO_WEBHOOK_HOST =
  "no webhook host or secret on this deployment: lore-api answered the ensure 503";

type RepoOutcome = "configured" | "failed";

type Judge = (
  repo: string,
  answer: EnsureAnswer,
  log: WebhookEnsureTickDeps["log"],
) => RepoOutcome | "unavailable";

export async function webhookEnsureTick(
  deps: WebhookEnsureTickDeps,
): Promise<string> {
  const tally: Record<RepoOutcome, string[]> = { configured: [], failed: [] };

  for (const repo of await deps.repos()) {
    const answer = await askFor(deps.ensure, repo);
    const outcome = judgeAnswer(repo, answer, deps.log);

    if (outcome === "unavailable") {
      return NO_WEBHOOK_HOST;
    }
    tally[outcome].push(repo);
  }

  return `webhook ensure: ${counted(tally, "configured")}, ${counted(tally, "failed")}`;
}

interface EnsuredStatus {
  state: string;
  hookId?: number;
}

/** A 200 carries the webhook's state after ensuring: only `configured` is done, since the route answers 200 for a hook it could not widen. */
const ensured: Judge = (repo, answer, log) => {
  const status = statusOf(answer.body);

  if (!status) {
    log(`${repo}: 200 with an unreadable status: ${answer.body.slice(0, 300)}`);

    return "failed";
  }
  const hook = status.hookId === undefined ? "" : `, hook ${status.hookId}`;

  if (status.state === "configured") {
    log(`${repo}: configured${hook}`);

    return "configured";
  }
  log(`${repo}: ${status.state} after ensuring${hook}`);

  return "failed";
};

function statusOf(body: string): EnsuredStatus | null {
  try {
    const parsed = JSON.parse(body) as Partial<EnsuredStatus>;

    return typeof parsed.state === "string"
      ? { state: parsed.state, hookId: parsed.hookId }
      : null;
  } catch {
    return null;
  }
}

const refused: Judge = (repo, answer, log) => {
  log(refusedLine(repo, answer));

  return "failed";
};

const JUDGES: Readonly<Partial<Record<number, Judge>>> = {
  200: ensured,
  503: () => "unavailable",
};

function judgeAnswer(
  repo: string,
  answer: EnsureAnswer,
  log: WebhookEnsureTickDeps["log"],
): RepoOutcome | "unavailable" {
  const judge = JUDGES[answer.status] ?? refused;

  return judge(repo, answer, log);
}
