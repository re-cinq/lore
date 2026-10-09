import { describe, it, expect } from "vitest";
import { grafanaUrl, headlampUrl } from "./headlamp-url";

describe("headlampUrl", () => {
  it("returns the dashboard address the deployment names", () => {
    expect(headlampUrl({ HEADLAMP_URL: "https://headlamp.example.com" })).toBe(
      "https://headlamp.example.com",
    );
  });

  it("names no address when the variable is unset", () => {
    expect(headlampUrl({})).toBeUndefined();
  });

  it("names no address when the variable is set but empty", () => {
    expect(headlampUrl({ HEADLAMP_URL: "" })).toBeUndefined();
  });

  it("names no address when the variable holds only whitespace", () => {
    expect(headlampUrl({ HEADLAMP_URL: "   " })).toBeUndefined();
  });

  it("trims surrounding whitespace off an address", () => {
    expect(
      headlampUrl({ HEADLAMP_URL: " https://headlamp.example.com\n" }),
    ).toBe("https://headlamp.example.com");
  });
});

describe("grafanaUrl", () => {
  it("returns the Grafana address the deployment names", () => {
    expect(grafanaUrl({ GRAFANA_URL: "https://grafana.example.com" })).toBe(
      "https://grafana.example.com",
    );
  });

  it("names no address when the variable is empty", () => {
    expect(grafanaUrl({ GRAFANA_URL: "" })).toBeUndefined();
  });
});
