import { describe, it, expect, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { definitionHash } from "@re-cinq/lore-assembly-lines";
import { ResumeRefusedError } from "@re-cinq/lore-shared/project/assembly-lines/resume.js";
import type { AssemblyLine } from "@re-cinq/lore-assembly-lines";
import { registerBearerAuth } from "../auth.js";
import { assemblyLineRerunRoute } from "./assembly-line-rerun.js";
import { assemblyLines } from "../../../kernel/queues.js";
import { projectFor } from "../../../composition/project-boot.js";
import { writeAuditLog } from "../../../jobs/lib/audit.js";

vi.mock("../../../kernel/queues.js", () => ({ assemblyLines: vi.fn() }));
vi.mock("../../../composition/project-boot.js", () => ({
  projectFor: vi.fn(),
}));
vi.mock("../../../jobs/lib/audit.js", () => ({
  writeAuditLog: vi.fn(async () => undefined),
}));

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;
  } else {
    process.env.LORE_INGEST_TOKEN = ORIG;
  }
  vi.clearAllMocks();
});

const IMPLEMENTATION = {
  name: "implementation",
  nodes: [{ id: "implement", type: "agent" }],
  edges: [],
} as unknown as AssemblyLine;

const SOURCE_LINE = {
  id: "line-1",
  definitionName: "implementation",
  repo: "re-cinq/lore",
  status: "failed",
};

function rerunServer(
  load = async () => new Map([["implementation", IMPLEMENTATION]]),
) {
  const server = Hapi.server({ port: 0 });

  registerBearerAuth(server);
  server.route(assemblyLineRerunRoute(load));

  return server;
}

const post = (server: Hapi.Server, payload: string, token = "ingest-secret") =>
  server.inject({
    method: "POST",
    url: "/api/assembly-lines/line-1/rerun",
    headers: { authorization: `Bearer ${token}` },
    payload,
  });

function mockPorts({
  line = SOURCE_LINE,
  start = vi.fn(async () => "line-2"),
}: {
  line?: typeof SOURCE_LINE | null;
  start?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.mocked(assemblyLines).mockReturnValue({
    getById: vi.fn(async () => line),
  } as unknown as ReturnType<typeof assemblyLines>);
  vi.mocked(projectFor).mockResolvedValue({
    assemblyLines: { start },
  } as unknown as Awaited<ReturnType<typeof projectFor>>);

  return start;
}

describe("POST /api/assembly-lines/{id}/rerun", () => {
  it("returns 401 on a wrong bearer token", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    mockPorts();

    const res = await post(
      rerunServer(),
      JSON.stringify({ node_id: "implement" }),
      "wrong",
    );

    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when node_id is missing", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    mockPorts();

    expect((await post(rerunServer(), "{}")).statusCode).toBe(400);
  });

  it("returns 404 when the assembly line does not exist", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    mockPorts({ line: null });

    const res = await post(
      rerunServer(),
      JSON.stringify({ node_id: "implement" }),
    );

    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when the run's definition is not a builtin assembly line", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    mockPorts({
      line: { ...SOURCE_LINE, definitionName: "onboard" },
    });

    const res = await post(
      rerunServer(),
      JSON.stringify({ node_id: "implement" }),
    );

    expect(res.statusCode).toBe(409);
    expect(res.result).toMatchObject({
      message: expect.stringContaining("onboard"),
    });
  });

  it("starts the fork with the current definition hash and returns 202", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    const start = mockPorts();

    const res = await post(
      rerunServer(),
      JSON.stringify({ node_id: "implement" }),
    );

    expect(res.statusCode).toBe(202);
    expect(res.result).toEqual({ started: "line-2" });
    expect(vi.mocked(projectFor)).toHaveBeenCalledWith("re-cinq/lore");
    expect(start).toHaveBeenCalledWith("implementation", {
      resumeFrom: { lineId: "line-1", nodeId: "implement" },
      definitionHash: definitionHash(IMPLEMENTATION),
    });
  });

  it("records who forked what in the audit log", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    mockPorts();

    await post(
      rerunServer(),
      JSON.stringify({ node_id: "implement", actor: "loredana" }),
    );

    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith({
      event_type: "assembly_line_rerun",
      repo: "re-cinq/lore",
      actor: "loredana",
      payload: {
        assembly_line_id: "line-2",
        resumed_from_line_id: "line-1",
        resumed_from_node_id: "implement",
      },
    });
  });

  it("still returns 202 when the audit write fails", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    mockPorts();
    vi.mocked(writeAuditLog).mockRejectedValueOnce(new Error("db down"));

    const res = await post(
      rerunServer(),
      JSON.stringify({ node_id: "implement" }),
    );

    expect(res.statusCode).toBe(202);
    expect(res.result).toEqual({ started: "line-2" });
  });

  it("maps a port refusal to 409 carrying the refusal message", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    mockPorts({
      start: vi.fn(async () => {
        throw new ResumeRefusedError(
          "resumeFrom definition hash mismatch: the definition changed since line-1 ran",
        );
      }),
    });

    const res = await post(
      rerunServer(),
      JSON.stringify({ node_id: "implement" }),
    );

    expect(res.statusCode).toBe(409);
    expect(res.result).toMatchObject({
      message: expect.stringContaining("hash mismatch"),
    });
  });

  it("maps a non-refusal failure to a sanitized 500, not a 409", async () => {
    process.env.LORE_INGEST_TOKEN = "ingest-secret";
    mockPorts({
      start: vi.fn(async () => {
        throw new Error("connection to 10.0.0.7:5432 refused");
      }),
    });

    const res = await post(
      rerunServer(),
      JSON.stringify({ node_id: "implement" }),
    );

    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.result)).not.toContain("10.0.0.7");
  });
});
