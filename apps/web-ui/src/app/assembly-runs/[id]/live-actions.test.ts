// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getServerSession = vi.fn();
const fetchAssemblyRun = vi.fn();
const userCanAccessRepo = vi.fn();
const mintRunStreamToken = vi.fn();

vi.mock("next-auth", () => ({ getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/assembly-runs", () => ({ fetchAssemblyRun }));
vi.mock("@/lib/user-repo-access", () => ({ userCanAccessRepo }));
vi.mock("@/lib/api/assembly-run-stream", () => ({ mintRunStreamToken }));

const { openRunChannelAction } = await import("./live-actions");

function signedIn() {
  getServerSession.mockResolvedValue({
    accessToken: "gho_x",
    login: "gedaiu",
    user: { name: "Bogdan" },
  });
  fetchAssemblyRun.mockResolvedValue({ id: "run-1", repo: "re-cinq/lore" });
  userCanAccessRepo.mockResolvedValue(true);
  mintRunStreamToken.mockResolvedValue({
    status: "ok",
    data: { token: "opaque", expires_at: "2026-09-23T10:10:00.000Z" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_INGEST_TOKEN = "tok";
});

afterEach(() => {
  delete process.env.LORE_API_URL;
  delete process.env.LORE_INGEST_TOKEN;
});

describe("openRunChannelAction", () => {
  it("mints a token for run-1 as gedaiu once GitHub confirms access to its repo", async () => {
    signedIn();

    expect({
      grant: await openRunChannelAction("run-1"),
      minted: mintRunStreamToken.mock.calls,
    }).toEqual({
      grant: { token: "opaque" },
      minted: [["run-1", { id: "gedaiu", name: "Bogdan" }]],
    });
  });

  it("asks a visitor without a session to sign in, minting nothing", async () => {
    getServerSession.mockResolvedValue(null);

    expect({
      grant: await openRunChannelAction("run-1"),
      minted: mintRunStreamToken.mock.calls.length,
    }).toEqual({ grant: { error: "Sign in to follow this run." }, minted: 0 });
  });

  it("refuses someone GitHub does not let see the repo, and names a run that is not there", async () => {
    signedIn();
    userCanAccessRepo.mockResolvedValue(false);
    const refused = await openRunChannelAction("run-1");

    fetchAssemblyRun.mockResolvedValue(null);

    expect({ refused, missing: await openRunChannelAction("run-9") }).toEqual({
      refused: { error: "You do not have access to this run's repo." },
      missing: { error: "This run was not found." },
    });
  });

  it("reports a mint lore-api refuses", async () => {
    signedIn();
    mintRunStreamToken.mockResolvedValue({ status: "error", error: "boom" });

    expect(await openRunChannelAction("run-1")).toEqual({
      error: "Could not open the run.",
    });
  });
});
