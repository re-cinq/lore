// Test support: a real HTTP server on 127.0.0.1 that answers every request with a fixed JSON body and records what it was sent, so a client built from env can be exercised without replacing `fetch`.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  url?: string;
  authorization?: string;
  body: Record<string, unknown>;
}

export interface RecordingHttpServer {
  /** The server's origin plus `/openai/v1`, the shape of an OpenAI-compatible base URL. */
  baseUrl: string;
  requests: RecordedRequest[];
  close(): void;
}

export async function startRecordingHttpServer(
  reply: unknown,
): Promise<RecordingHttpServer> {
  const requests: RecordedRequest[] = [];
  const server = recordingServer(reply, requests);

  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/openai/v1`,
    requests,
    close: () => server.close(),
  };
}

function recordingServer(reply: unknown, requests: RecordedRequest[]): Server {
  return createServer((req, res) => {
    let body = "";

    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({
        url: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(body),
      });
      res.end(JSON.stringify(reply));
    });
  });
}
