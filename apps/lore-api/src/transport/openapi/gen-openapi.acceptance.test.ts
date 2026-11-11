import { describe, it, expect } from "vitest";
import { generateOpenApi } from "./build-document.js";
import { routeList } from "../route-list.js";

describe("OpenAPI generation for plan lifecycle routes", () => {
  it("includes dynamically registered planning lifecycle routes in the generated document", () => {
    const { document } = generateOpenApi(routeList(() => null));

    expect(document.paths).toHaveProperty(
      "/api/repos/{owner}/{repo}/plans/{id}/approve",
    );
  });
});
