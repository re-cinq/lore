import { describe, it, expect, vi } from "vitest";
import { buildServer } from "./build-server.js";

describe("lore-api request-error logging (#1324)", () => {
  it("names an unexpected route throw on the console instead of 500ing anonymously", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = buildServer(() => null);

    server.route({
      method: "GET",
      path: "/boom",
      handler: () => {
        throw new Error("pool exhausted");
      },
    });

    try {
      const res = await server.inject({ method: "GET", url: "/boom" });

      expect(res.statusCode).toBe(500);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[http\] GET \/boom 500 .*pool exhausted/s),
      );
    } finally {
      errorSpy.mockRestore();
      await server.stop();
    }
  });
});
