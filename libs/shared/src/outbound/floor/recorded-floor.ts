// A real floor client over a recorded fetch: what a test asserts is the wire the floor would have seen, with no server and no double of the client itself.
import {
  createFloorClient,
  serviceToken,
  type FloorClient,
} from "@re-cinq/floor-client";

export interface FloorRequest {
  method: string;
  path: string;
  body: unknown;
}

/** The JSON a request is answered with, or a whole `Response` to answer with as it is; `undefined` answers 404. */
export type FloorAnswer = (request: FloorRequest) => unknown;

export interface RecordedFloor {
  floor: FloorClient;
  requests: FloorRequest[];
}

const FLOOR_URL = "http://floor.test";
const HTTP_NOT_FOUND = 404;

export function recordedFloor(answer: FloorAnswer): RecordedFloor {
  const requests: FloorRequest[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    const request = requestOf(String(input), init);

    requests.push(request);

    return Promise.resolve(responseOf(answer(request)));
  };

  return {
    floor: createFloorClient({
      url: FLOOR_URL,
      token: serviceToken("test-token"),
      fetchFn,
    }),
    requests,
  };
}

function requestOf(url: string, init: RequestInit | undefined): FloorRequest {
  return {
    method: init?.method ?? "GET",
    path: url.replace(FLOOR_URL, ""),
    body: bodyOf(init?.body),
  };
}

function bodyOf(body: BodyInit | null | undefined): unknown {
  if (typeof body === "string") {
    return JSON.parse(body);
  }

  return body instanceof Uint8Array ? new TextDecoder().decode(body) : null;
}

function responseOf(answered: unknown): Response {
  if (answered instanceof Response) {
    return answered;
  }

  return answered === undefined
    ? new Response(JSON.stringify({ title: "Not Found", status: 404 }), {
        status: HTTP_NOT_FOUND,
      })
    : new Response(JSON.stringify(answered));
}
