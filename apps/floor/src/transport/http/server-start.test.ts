import { describe, it, expect, afterEach, vi } from "vitest";
import net from "node:net";
import { startHealthServer } from "./server.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const spies = () => ({
  exit: vi
    .spyOn(process, "exit")
    .mockImplementation((() => undefined) as () => never),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
});

const takenPort = async (): Promise<{ port: number; release: () => void }> => {
  const blocker = net.createServer();

  await new Promise<void>((resolve) => blocker.listen(0, resolve));

  const address = blocker.address() as net.AddressInfo;

  return { port: address.port, release: () => blocker.close() };
};

describe("startHealthServer failure paths", () => {
  it("logs the port-in-use message and exits 1 when the port is taken", async () => {
    const { port, release } = await takenPort();
    const { exit, error } = spies();

    await startHealthServer(port, () => ({}));
    release();

    expect(String(error.mock.calls[0]?.[0])).toContain(
      `port ${port} already in use`,
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("logs the generic error message and exits 1 on EACCES from a privileged port 80", async () => {
    const { exit, error } = spies();

    await startHealthServer(80, () => ({}));

    expect(error.mock.calls[0]?.[0]).toBe("[floor] Health server error:");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
