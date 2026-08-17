/**
 * Every outbound `fetch` carries a signal, so it cannot hang forever.
 *
 * A `fetch` without one waits as long as the peer keeps the socket open, which in
 * practice is until something else times out — and in a single-threaded job loop
 * that means the loop, not the call. This is not hypothetical here: it froze
 * spec-trace ingestion once, which is why the Floor's event loop grew a
 * `SERIAL_DEADLINE_MS` guard (`apps/floor/src/main-loop/loop.ts`). The guard
 * bounds the damage; it does not stop the call from hanging.
 *
 * A one-time sweep would not hold — 50 sites were fixed, and the next `fetch`
 * anyone writes is the regression. So the invariant lives here instead of in a
 * commit message.
 *
 * `signal:` satisfies the rule, whatever produces it. `AbortSignal.timeout(ms)` is
 * the usual answer, but a caller-supplied signal is a deliberate decision about
 * who owns the deadline, and a rule that insisted on the literal form would push
 * people to re-derive a timeout they were handed.
 *
 * A spread (`{ ...opts }`) passes: the signal may well be inside, this rule cannot
 * see it, and guessing wrong in the noisy direction is how a rule gets disabled.
 *
 * The exception is a request MEANT to stay open — an SSE stream, a log tail. Those
 * disable the rule on the line, with a reason, so the intent is stated where the
 * call is rather than inferred by the next reader.
 */

/** `signal: <anything but undefined>` among an options object's properties. */
function carriesSignal(options) {
  if (options?.type !== "ObjectExpression") {
    return false;
  }

  return options.properties.some((property) => {
    if (property.type === "SpreadElement") {
      // Cannot see inside; treat as possibly carrying it rather than report.
      return true;
    }

    const key = property.key;
    const named =
      (key?.type === "Identifier" && key.name === "signal") ||
      (key?.type === "Literal" && key.value === "signal");

    if (!named) {
      return false;
    }

    // `signal: undefined` is an absent deadline wearing the right key.
    return !(
      property.value?.type === "Identifier" &&
      property.value.name === "undefined"
    );
  });
}

/** The bare global, not `client.fetch(...)` / `this.fetch(...)`. */
function isGlobalFetch(node) {
  return node.callee.type === "Identifier" && node.callee.name === "fetch";
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "require a signal on every outbound fetch so it cannot hang forever",
    },
    schema: [],
    messages: {
      noTimeout:
        "fetch has no signal and can hang forever — pass `signal: AbortSignal.timeout(ms)` (or a caller's signal). A request meant to stay open (SSE, log tail) disables this rule on the line with a reason.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isGlobalFetch(node) || carriesSignal(node.arguments[1])) {
          return;
        }

        context.report({ node, messageId: "noTimeout" });
      },
    };
  },
};
