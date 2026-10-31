// The two calls the context evals make to lore-api, with the bearer token CI already holds for ingest. A missing address or token is refused by name: a job that skips quietly is how the old evals check stayed green for months while evaluating nothing.

const REQUIRED = ["LORE_API_URL", "LORE_INGEST_TOKEN"];

export function loreApi({ env, fetchFn = fetch }) {
  for (const name of REQUIRED) {
    if (!env[name]) {
      throw new Error(`${name} is not set: the context evals cannot ask Lore`);
    }
  }
  const headers = {
    Authorization: `Bearer ${env.LORE_INGEST_TOKEN}`,
    "Content-Type": "application/json",
  };
  const send = async (path, init) =>
    answerOf(await fetchFn(new URL(path, env.LORE_API_URL).href, init));

  return {
    get: (path) => send(path, { headers }),
    post: (path, body) =>
      send(path, { method: "POST", headers, body: JSON.stringify(body) }),
  };
}

async function answerOf(response) {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiRefusal(response.status, body.error ?? "no reason given");
  }

  return body;
}

export class ApiRefusal extends Error {
  constructor(status, reason) {
    super(`lore-api answered ${status}: ${reason}`);
    this.status = status;
  }
}

// 500 is in the list because a rate limit of the model reaches the runner as one.
const RETRIED = new Set([429, 500, 502, 503, 504]);
const RETRY_AFTER_MS = [5000, 15000];

/** A refusal that may pass and a connection that failed are asked again, twice, with a wait between; the last failure is thrown. */
export async function patiently({ pause = wait }, call) {
  let failure;

  for (const delay of [0, ...RETRY_AFTER_MS]) {
    if (delay > 0) {
      await pause(delay);
    }

    try {
      return await call();
    } catch (err) {
      failure = err;

      if (err instanceof ApiRefusal && !RETRIED.has(err.status)) {
        break;
      }
    }
  }

  throw failure;
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
