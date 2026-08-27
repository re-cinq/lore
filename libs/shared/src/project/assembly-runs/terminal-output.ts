// The bound on a visit's stored terminal output.
//
// The output is the agent's whole NDJSON stream, and it is large — 261KB for one
// ten-minute review, ~1.4MB for a long implementation node. Storing it whole is
// how 180 accumulated Agent CRs blew Node's heap on 2026-07-24, and the lesson
// does not stop applying because the bytes moved into Postgres.
//
// The TAIL is what is kept, not the head: every parser downstream scans backwards
// for the terminal result line (`resultTextFromOutput`, `terminalErrorText`), so
// the last bytes are the ones carrying the verdict, the outcome and the error.

/**
 * 2 MiB — chosen so that OUR cap is never the binding one.
 *
 * The source is already capped upstream: every terminal Agent CR measured on a
 * live cluster carries a `status.output` just under 256 KiB (max 262,031 of
 * 262,144), clustered against that ceiling and cut on a line boundary. The
 * subsystem truncates before the Floor ever sees it, so the Floor has never held
 * a complete stream from this source and a tighter cap here would only truncate
 * a second time.
 *
 * Sized against the ARTIFACT reader rather than the verdict reader, which is why
 * it is not simply 256 KiB: a verdict needs the last few KB, but
 * `artifactsFromTerminalOutput` scans the whole stream for file events emitted as
 * the work happens. Cutting the head off would read a node's artifacts as
 * DECLARED BUT NOT PRODUCED. The sink lane remains the primary artifact path
 * precisely because the CR's copy is lossy — see `artifact-args.ts`.
 *
 * Deliberately above the upstream number rather than equal to it: if the
 * subsystem ever raises its own cap, this one should not quietly become the
 * truncation nobody chose.
 */
export const TERMINAL_OUTPUT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The last {@link TERMINAL_OUTPUT_MAX_BYTES} of `output`, cut on a character
 * boundary.
 *
 * Bounded in BYTES because that is what the storage cares about, then walked
 * forward off any continuation byte the cut landed inside — slicing UTF-8 by
 * byte count otherwise yields a replacement character at the seam, and the seam
 * is inside the JSON the parsers are about to read.
 */
export function capTerminalOutput(output: string): string {
  const bytes = Buffer.from(output, "utf8");

  if (bytes.byteLength <= TERMINAL_OUTPUT_MAX_BYTES) {
    return output;
  }
  const tail = bytes.subarray(bytes.byteLength - TERMINAL_OUTPUT_MAX_BYTES);
  let start = 0;

  while (start < tail.length && (tail[start] & 0xc0) === 0x80) {
    start++;
  }

  return tail.subarray(start).toString("utf8");
}
