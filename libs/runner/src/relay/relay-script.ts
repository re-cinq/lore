/**
 * The BYO toolchain relay (ADR-025, sidecar model). This POSIX-sh script is the
 * command the repo's container runs: it watches a control directory on the
 * volume shared with the kernel container, runs each requested command in its
 * own environment (so the repo's real toolchain — `go vet`, `cargo check`, … —
 * executes), and writes the result back. The BYO image needs nothing but `sh`
 * plus its toolchain; no Lore binary is injected into it.
 *
 * Protocol (files under `$LORE_RELAY_DIR`, driven by {@link RelayExecutor}):
 *   kernel writes  req-<n>.sh  then  req-<n>.ready
 *   relay runs it in $LORE_RELAY_WORKDIR, then writes (in order)
 *     res-<n>.out, res-<n>.err, res-<n>.code, and finally res-<n>.done
 *   `res-<n>.done` is created last so the kernel never reads a partial result.
 *   A `shutdown` file makes the relay exit (ending the sidecar).
 */
export const RELAY_SCRIPT = `#!/bin/sh
set -u
RELAY_DIR="\${LORE_RELAY_DIR:-/workspace/.lore/relay}"
WORKDIR="\${LORE_RELAY_WORKDIR:-/workspace/repo}"
mkdir -p "$RELAY_DIR"
: > "$RELAY_DIR/relay.up"
while true; do
  [ -f "$RELAY_DIR/shutdown" ] && exit 0
  found=0
  for ready in "$RELAY_DIR"/req-*.ready; do
    [ -e "$ready" ] || continue
    found=1
    base=\$(basename "$ready" .ready)
    n=\${base#req-}
    cmd="$RELAY_DIR/req-$n.sh"
    mv "$ready" "$RELAY_DIR/req-$n.taken" 2>/dev/null || continue
    ( cd "$WORKDIR" 2>/dev/null && sh "$cmd" ) > "$RELAY_DIR/res-$n.out" 2> "$RELAY_DIR/res-$n.err"
    echo $? > "$RELAY_DIR/res-$n.code"
    : > "$RELAY_DIR/res-$n.done"
  done
  [ "$found" = 0 ] && sleep 0.2
done
`;
