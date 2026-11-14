// A socket for component tests: it opens by itself and answers every `request` with what the test's handler says, so a component under test runs on a real LiveSocketClient.
import { LiveSocketClient, type SocketConstructor } from "./client";
import { FakeWebSocket } from "./fake-web-socket";
import { setLiveClient } from "@/lib/live-fetch";
import type { LiveClientMessage } from "./protocol";

export type RecordedRequest = Extract<LiveClientMessage, { type: "request" }>;

export interface RequestAnswerFixture {
  status: number;
  body: unknown;
}

export type RequestHandler = (
  request: RecordedRequest,
) => RequestAnswerFixture | Promise<RequestAnswerFixture>;

export type FetchLike = (
  path: string,
  init: { method: string; body?: unknown },
) => Promise<Response>;

/** A socket class that answers requests from `handler` and records them in `asked`. It is a FakeWebSocket, so a test still drives channel opens by hand. */
export function answeringSocket(
  handler: RequestHandler,
  asked: RecordedRequest[] = [],
  accepts: (instanceNumber: number) => boolean = () => true,
): SocketConstructor {
  return class AnsweringSocket extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      openSoon(this, accepts);
    }

    send(text: string): void {
      super.send(text);
      answerIfRequest(this, JSON.parse(text) as LiveClientMessage, {
        handler,
        asked,
      });
    }
  };
}

function openSoon(
  socket: FakeWebSocket,
  accepts: (instanceNumber: number) => boolean,
): void {
  queueMicrotask(
    () => accepts(FakeWebSocket.instances.length) && socket.accept(),
  );
}

interface Answering {
  handler: RequestHandler;
  asked: RecordedRequest[];
}

function answerIfRequest(
  socket: FakeWebSocket,
  message: LiveClientMessage,
  { handler, asked }: Answering,
): void {
  if (message.type === "request") {
    asked.push(message);
    void answerWith(socket, message, handler);
  }
}

async function answerWith(
  socket: FakeWebSocket,
  message: RecordedRequest,
  handler: RequestHandler,
): Promise<void> {
  const answer = await Promise.resolve(handler(message)).catch(
    (error: Error) => ({ status: 502, body: { error: error.message } }),
  );

  socket.receive({ type: "response", id: message.id, ...answer });
}

/** Makes `liveFetch` answer from `handler` and returns the requests it was asked, in order. */
export function serveLiveRequests(handler: RequestHandler): RecordedRequest[] {
  const asked: RecordedRequest[] = [];

  setLiveClient(
    new LiveSocketClient({
      url: "ws://test/api/ws",
      socket: answeringSocket(handler, asked),
    }),
  );

  return asked;
}

const handlerFrom =
  (fetchLike: FetchLike): RequestHandler =>
  async (request) => {
    const response = await fetchLike(request.path, {
      method: request.method,
      ...(request.body === undefined ? {} : { body: request.body }),
    });

    return {
      status: response.status,
      body: await response.json().catch(() => null),
    };
  };

/** The socket class a `LiveSocketProvider` takes, answering from a `fetch`-shaped function; `accepts` says which of the sockets it builds (counted from 1) open at all. */
export function answeringSocketFrom(
  fetchLike: FetchLike,
  accepts?: (instanceNumber: number) => boolean,
): SocketConstructor {
  return answeringSocket(handlerFrom(fetchLike), [], accepts);
}

/** Makes `liveFetch` answer from a `fetch`-shaped function, for a test whose stub already speaks in URLs and Responses. */
export function liveRequestsFrom(fetchLike: FetchLike): RecordedRequest[] {
  return serveLiveRequests(handlerFrom(fetchLike));
}
