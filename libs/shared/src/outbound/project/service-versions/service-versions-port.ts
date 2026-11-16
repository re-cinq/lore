import type { ServiceVersion } from "../../../domain/models/service-version.js";

/** `lore.service_versions`: each Lore service records the build it runs when it starts; `GET /api/versions` lists them. */
export interface ServiceVersionsPort {
  /** Replace the service's row with this start. */
  record(version: ServiceVersion): Promise<void>;
  list(): Promise<ServiceVersion[]>;
}
