// lore-api reads that survive a slow floor: a 5xx, which is what a floor page that timed out inside lore-api reaches us as, is asked again twice with a wait between.

const RETRIED = new Set([500, 502, 503, 504]);
const RETRY_AFTER_MS = [5000, 15000];

const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

export function patientApi(api, pause = wait) {
  const get = async (path, delays = RETRY_AFTER_MS) => {
    try {
      return await api.get(path);
    } catch (failure) {
      if (!RETRIED.has(failure.status) || delays.length === 0) {
        throw failure;
      }
      await pause(delays[0]);

      return get(path, delays.slice(1));
    }
  };

  return { get: (path) => get(path) };
}
