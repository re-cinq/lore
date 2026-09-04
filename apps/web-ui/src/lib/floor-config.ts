export interface FloorConfig {
  floorUrl: string;
  token: string;
}

/** The Floor's URL + bearer token, or null when either env var is unset. */
export function resolveFloorConfig(): FloorConfig | null {
  const floorUrl = process.env.LORE_FLOOR_URL;
  const token = process.env.LORE_INGEST_TOKEN;

  if (!floorUrl || !token) {
    return null;
  }

  return { floorUrl, token };
}
