import { apiError, rethrowBoom } from "@re-cinq/lore-shared/http/api-error.js";

/** An eval that could not be made is not the caller's fault and not a crash: the model or a store it reads refused, so the answer is 502 with the reason. A bare 500 hid a retired model id for a week (#4542). */
export async function evalOrRefusal<T>(evaluate: () => Promise<T>): Promise<T> {
  try {
    return await evaluate();
  } catch (err) {
    rethrowBoom(err);
    const reason = err instanceof Error ? err.message : String(err);

    throw apiError(502)(`the eval could not be made: ${reason}`);
  }
}
