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
 * 2 MiB — above every stream measured (261KB for a ten-minute review, ~1.4MB for
 * a long implementation node), and still a bound.
 *
 * Sized by the ARTIFACT reader, not the verdict reader. A verdict needs only the
 * last few KB, so 256 KiB was ample for it — but `artifactsFromTerminalOutput`
 * scans the whole stream for the file events a node declared, and those are
 * emitted as the work happens, not at the end. Cut the head off a long node's
 * stream and its artifacts read as DECLARED BUT NOT PRODUCED, which fails the
 * node for a truncation nobody performed on purpose.
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
