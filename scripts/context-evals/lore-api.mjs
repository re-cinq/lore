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
