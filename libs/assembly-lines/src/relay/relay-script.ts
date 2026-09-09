// The BYO toolchain relay (ADR-025, sidecar model): a POSIX-sh script the repo's container runs, watching a shared control directory, running each requested command in its own environment, writing results back — no Lore binary injected. Protocol under $LORE_RELAY_DIR (driven by RelayExecutor): kernel writes req-<n>.sh then req-<n>.ready; relay runs it in $LORE_RELAY_WORKDIR then writes res-<n>.{out,err,code} and finally res-<n>.done (created last so the kernel never reads a partial result); a `shutdown` file ends the sidecar.
export const RELAY_SCRIPT = `#!/bin/sh
set -u
RELAY_DIR="\${LORE_RELAY_DIR:-/workspace/.lore/relay}"
WORKDIR="\${LORE_RELAY_WORKDIR:-/workspace/repo}"
mkdir -p "$RELAY_DIR"
[ -n "\${HOME:-}" ] && mkdir -p "$HOME" 2>/dev/null || true
: > "$RELAY_DIR/relay.up"
while true; do
  [ -f "$RELAY_DIR/shutdown" ] && exit 0
  found=0
  for ready in "$RELAY_DIR"/req-*.ready; do
    [ -e "$ready" ] || continue
    found=1
    base=$(basename "$ready" .ready)
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
