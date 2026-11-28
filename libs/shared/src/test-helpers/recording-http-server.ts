// Test support: a real HTTP server on 127.0.0.1 that answers every request with a fixed JSON body, or a redirect, and records what it was sent, so a client built from env can be exercised without replacing `fetch`.

import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const BASE_PATH = "/openai/v1";

export interface RecordedRequest {
  url?: string;
  authorization?: string;
  xApiKey?: string | string[];
  body: Record<string, unknown>;
}

export interface RecordingHttpServerOptions {
  /** Answers a request under `/openai/v1` with a 307 to the same path under this base, a URL or a path on this server; every other request gets the reply. */
  redirectTo?: string;
}

export interface RecordingHttpServer {
  /** The server's origin plus `/openai/v1`, the shape of an OpenAI-compatible base URL. */
  baseUrl: string;
  requests: RecordedRequest[];
  close(): void;
}

export async function startRecordingHttpServer(
  reply: unknown,
  options: RecordingHttpServerOptions = {},
): Promise<RecordingHttpServer> {
  const requests: RecordedRequest[] = [];
  const server = recordingServer(reply, requests, options);

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}${BASE_PATH}`,
    requests,
    close: () => server.close(),
  };
}

function recordingServer(
  reply: unknown,
  requests: RecordedRequest[],
  options: RecordingHttpServerOptions,
): Server {
  return createServer((req, res) => {
    let body = "";

    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({
        url: req.url,
        authorization: req.headers.authorization,
        xApiKey: req.headers["x-api-key"],
        body: JSON.parse(body),
      });
      answer(res, reply, redirectOf(req.url, options));
    });
  });
}

/** Where a request is sent on, or null when it is answered here; only paths under the base URL move, so the target of a same-origin redirect is answered. */
function redirectOf(
  url: string | undefined,
  { redirectTo }: RecordingHttpServerOptions,
): string | null {
  const path = url ?? "";

  return redirectTo && path.startsWith(BASE_PATH)
    ? `${redirectTo}${path.slice(BASE_PATH.length)}`
    : null;
}

function answer(
  res: ServerResponse,
  reply: unknown,
  location: string | null,
): void {
  if (location) {
    res.writeHead(307, { Location: location });
    res.end();

    return;
  }
  res.end(JSON.stringify(reply));
}
