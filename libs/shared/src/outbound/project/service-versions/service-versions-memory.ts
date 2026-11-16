import type { ServiceVersion } from "../../../domain/models/service-version.js";
import type { ServiceVersionsPort } from "./service-versions-port.js";

/** In-memory ServiceVersionsPort, the behavioral spec of the pg adapter: one row per service, listed by service name. */
export class InMemoryServiceVersions implements ServiceVersionsPort {
  private readonly rows = new Map<string, ServiceVersion>();

  async record(version: ServiceVersion): Promise<void> {
    this.rows.set(version.service, version);
  }

  async list(): Promise<ServiceVersion[]> {
    return [...this.rows.values()].sort((a, b) =>
      a.service.localeCompare(b.service),
    );
  }
}
