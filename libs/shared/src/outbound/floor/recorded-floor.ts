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
const LINE_START = /^\/assembly-lines\/([^/]+)\/start$/;

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

/** A recorded floor that answers line starts by its own rule (the `assembly_runs_subject_open` index): one open run per repository and subject, whichever line holds it. A started run's id names its line. */
export function oneOpenRunPerSubject(
  subjectOf: (lineId: string) => string,
): RecordedFloor {
  const open = new Map<string, string>();

  return recordedFloor((request) => {
    const lineId = LINE_START.exec(request.path)?.[1];

    return lineId
      ? startOnSubject(open, lineId, subjectOf(lineId), request)
      : { items: [], nextCursor: null };
  });
}

function startOnSubject(
  open: Map<string, string>,
  lineId: string,
  subject: string,
  request: FloorRequest,
): { run: { id: string | undefined }; joined: boolean } {
  const { startItems } = request.body as {
    startItems: Record<string, { ref: string }>;
  };
  const key = `${subject}:${startItems[subject].ref}`;
  const joined = open.has(key);

  if (!joined) {
    open.set(key, `run-on-${lineId}`);
  }

  return { run: { id: open.get(key) }, joined };
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
