#!/bin/sh
# Claude Code PreToolUse guard for the Bash tool, shipped to every agent pod
# inside the lore-context skill and wired from the Claude hook bundle
# (agent-skills/hooks/claude/.claude/settings.json, which the registry also
# serves as the flat /skills/settings.json).
#
# Reads the hook event on stdin and refuses the test-runner invocations the
# recipe forbids. Exit 2 blocks the call; stderr reaches the agent as the
# reason. Everything else exits 0 and the call proceeds.
#
# LORE_TEST_POLICY, set per recipe on the Agent CR:
#   scoped  (default) a runner may run only when its own command segment names
#                     test files or a path, a workspace package or a Go package
#                     path, or follows a cd into a subdirectory. Bare suite
#                     runs are refused.
#   none              no runner, no build, and no install but the lockfile one
#                     (npm ci) a linter needs.
#   any               guard off.
#
# Under scoped and none alike a linter or formatter runs only over the files or
# paths it names: a whole-repository lint, a lint script and a linter npx would
# download are refused. In this repository a two-file eslint holds ~1.2 GB and
# seven packages in one call over 2 GB.
#
# LORE_ACCEPTANCE_DOD, set on the implementation loop's rounds: the path of the
# branch's .lore/dod.md. Its "Done when these pass" tests are CI's to run, so a
# runner naming one is refused, and so is one naming no test file at all, which
# would sweep them in. Unset, or the file not written yet, changes nothing.
#
# The command is judged one segment at a time (split on ; & | and newlines,
# parentheses and braces) so a test-file name in a comment or in a neighbouring
# command cannot vouch for a bare runner, and quotes count as whitespace so
# `sh -c "npm test"` reads as `npm test`.
#
# POSIX sh + grep -E / sed -E only: the hook bundle also runs on other vendors' images,
# which promise neither bash nor jq.

policy="${LORE_TEST_POLICY:-scoped}"
[ "$policy" = "any" ] && exit 0
# Segments and tokens are split by hand below; nothing here may glob.
set -f

event=$(cat)

json_string() {
  printf '%s' "$event" | grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]|\\\\.)*\"" | head -n 1 | sed -E "s/^\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"\$//"
}

# JSON escapes: an escaped backslash collapses first so it cannot masquerade as
# another escape, whitespace escapes and escaped quotes become spaces, and so do
# shell quotes, so a quoted or wrapped runner reads like a bare one.
command=$(json_string command | sed 's/\\\\/ /g; s/\\[ntr]/ /g; s/\\"/ /g; s/\\\//\//g' | tr "\"'\`" '   ')
[ -z "$command" ] && exit 0
cwd=$(json_string cwd | sed 's/\\\//\//g; s:/*$::')

W='[[:space:]]'
NW='[^[:space:]]'
RUNNER="(^|$W)(((npx|pnpm|yarn|bunx?)$W+((exec|dlx)$W+)?)|python3?$W+-m$W+|(\.\.?/)?($NW*/)?node_modules/\.bin/)?(vitest|jest|mocha|ava|tap|pytest)($W|$)"
RUNNER="$RUNNER|(^|$W)node$W+($NW*/)?(vitest|jest)(\.m?js)?($W|$)|(^|$W)node$W+--test(=|$W|$)"
RUNNER="$RUNNER|(^|$W)(cargo$W+test|go$W+test|deno$W+test|playwright$W+test|cypress$W+run|make$W+(test|check|coverage)$NW*|turbo$W+(run$W+)?test|lerna$W+run$W+test|nx$W+(test|run-many))($W|$)"
SCRIPT="(^|$W)(npm|pnpm|yarn|bun)$W+((run|run-script)$W+)?(test|tst|t|coverage)(:$NW*)?($W|$)"
INSTALL="^((npm|pnpm|bun)$W+(ci|install|i|add)|yarn($W+(install|add))?|pip3?$W+install|uv$W+(sync|pip$W+install)|poetry$W+install|go$W+mod$W+download)($W|$)"
BUILD="^((npm|pnpm|yarn|bun)$W+(run$W+)?build(:$NW*)?|(npx$W+|(\.\.?/)?($NW*/)?node_modules/\.bin/)?tsc|go$W+(build|install|generate)|cargo$W+(build|check)|make|docker$W+build)($W|$)"
LOCKFILE_INSTALL="^(npm$W+ci|(pnpm|yarn|bun)($W+install)?($W+-$NW+)*$W+--(frozen-lockfile|immutable))($W|$)"
# Linters and formatters run over named files only. Reaching one through npx without
# --no-install downloads it into the pod, which is how a review pod fetched eslint@10 (#2155).
LINT="^((npx|bunx)$W+(-$NW+$W+)*|(pnpm|yarn|bun)$W+(dlx|exec|x)$W+|(\.\.?/)?($NW*/)?node_modules/\.bin/)?(eslint|prettier|biome|ruff|black|golangci-lint)($W|$)"
LINT_DOWNLOAD="^((pnpm|yarn|bun)$W+(dlx|x)|bunx)$W"
LINT_SCRIPT="^(npm|pnpm|yarn|bun)$W+(run$W+)?(lint|format|fmt|typecheck|type-check|check)(:$NW*)?($W|$)"
TEST_FILE="\.(test|spec)\.[cm]?[jt]sx?($W|:|$)|_test\.go($W|$)|(^|$W|/)test_[A-Za-z0-9_]+\.py"
WORKSPACE="(^|$W)(-w|--workspace|--filter|--project)(=|$W+)[^-[:space:]]"
GO_PACKAGE="go$W+test($W+-$NW+)*$W+\./[A-Za-z0-9_][A-Za-z0-9_/.-]*($W|$)"
CARGO_PACKAGE="cargo$W+test($W+$NW+)*$W+(-p|--package)(=|$W)"
EXCLUDE="(^|$W)--exclude(=|$W|$)"
# Leading env assignments and the wrappers that run a command unchanged; what is
# left is the command the segment actually runs.
# A segment that only reads (grep, cat, git log ...) can mention a runner without running one.
READ_ONLY="^(grep|rg|egrep|fgrep|cat|sed|awk|ls|find|git|gh|head|tail|wc|diff|jq|yq|stat|tree|which|type|man)($W|$)"
HEAD="^([A-Za-z_][A-Za-z0-9_]*=$NW*$W+)*((env|time|nohup|command|exec|sudo|eval|(sh|bash|dash|zsh)$W+-c)$W+|timeout$W+$NW+$W+)*"

matches() {
  printf '%s' "$1" | grep -qE "$2"
}

refuse() {
  printf '[lore] blocked: %s\n' "$1" >&2
  exit 2
}

# The command a segment runs, without its env assignments and wrappers.
head_of() {
  printf '%s' "$1" | sed -E "s/^$W+//; s/$HEAD//"
}

# Where a `cd` lands: sub for a subdirectory (relative or absolute), root for the
# repo root itself, the previous directory, home, or a target the hook cannot read.
cd_scope() {
  target=$(printf '%s' "$1" | sed -E "s/^cd($W+|$)//; s/$W.*$//; s:/+$::")
  case "$target" in
    ''|-|'~'|'$'*) echo root; return;;
  esac
  if matches "$target" '^(\.\.?/)*\.?\.?$' || [ "$target" = "$cwd" ]; then
    echo root
  else
    echo sub
  fi
}

# True when a positional argument after the runner names a file or a directory,
# skipping the values of flags that take one (a config file is not a scope).
names_path() (
  IFS=' '
  seen=0
  prev=''
  for tok in $1; do
    if [ "$seen" = 0 ]; then
      case "${tok##*/}" in
        vitest|vitest.mjs|jest|jest.js|mocha|ava|tap|pytest|npm|pnpm|yarn|bun|go) seen=1;;
      esac
      continue
    fi
    case "$prev" in
      --config|-c|--root|-r|--dir|-t|--testNamePattern|--reporter|--outputFile|-o|--pool|--shard|--exclude)
        prev=$tok
        continue;;
    esac
    prev=$tok
    case "$tok" in
      -*|run|related|watch|test|tst|t|coverage|exec|dlx|run-script|...|*/...) ;;
      */*|*.py) return 0;;
    esac
  done
  return 1
)

# True when a linter's positional arguments name a file or a path other than the
# repository root, skipping subcommands and the values of flags that take one.
lint_names_path() (
  IFS=' '
  seen=0
  skip=0
  for tok in $1; do
    if [ "$seen" = 0 ]; then
      case "${tok##*/}" in
        eslint|prettier|biome|ruff|black|golangci-lint) seen=1;;
      esac
      continue
    fi
    if [ "$skip" = 1 ]; then
      skip=0
      continue
    fi
    case "$tok" in
      -c|--config|--ext|--rule|-f|--format|-o|--output-file|--plugin|--parser|--parser-options|--resolve-plugins-relative-to|--max-warnings|--ignore-pattern|--ignore-path|--cache-location|--rulesdir|--env|--global|--log-level|--select|--ignore|--extend-select|--line-length|--target-version|--timeout|-E|--enable|-D|--disable|--out-format|--new-from-rev)
        skip=1;;
      -*|check|run|format|lint|fmt|.|./|./...|...|"$cwd"|"$cwd/") ;;
      *) return 0;;
    esac
  done
  return 1
)

downloads_linter() {
  matches "$1" "$LINT_DOWNLOAD" && return 0
  matches "$1" "^npx$W" && ! matches "$1" "$W--no(-install)?($W|$)"
}

LINT_HOW="Lint the files you changed, one package per call: \`NODE_OPTIONS=--max-old-space-size=3072 timeout 300 npx --no-install eslint --fix <files>\`, after \`npm ci\` when eslint is not installed."

scoped_runner() {
  if matches "$1" "$EXCLUDE"; then
    return 1
  fi
  matches "$1" "$TEST_FILE" || matches "$1" "$WORKSPACE" || matches "$1" "$GO_PACKAGE" \
    || matches "$1" "$CARGO_PACKAGE" || names_path "$1"
}

# Basenames of the test files under "## Done when these pass", dots escaped for grep -E.
# Basenames, not paths: after a `cd` the runner names the file relative to the
# package, so a full-path match would let the same file through.
acceptance=''
if [ -n "$LORE_ACCEPTANCE_DOD" ] && [ -r "$LORE_ACCEPTANCE_DOD" ]; then
  acceptance=$(sed -n '/^## Done when these pass/,/^## /p' "$LORE_ACCEPTANCE_DOD" \
    | grep -oE '`[^`]+`' | tr -d '`' | grep -E "$TEST_FILE" \
    | sed -E 's:.*/::; s/\./\\./g')
fi

acceptance_check() {
  [ -z "$acceptance" ] && return 0
  for name in $acceptance; do
    if matches "$1" "(^|$W|/)$name($W|:|$)"; then
      refuse "acceptance tests are CI's to run, and the definition of done lists this one. Run the test you wrote this round and read CI's verdict on the acceptance tests with lore_get_ci_failures."
    fi
  done
  if ! matches "$1" "$TEST_FILE"; then
    refuse "name the test file you wrote this round, e.g. \`cd <package> && timeout 300 npx vitest run <file.test.ts>\`. A run over a directory sweeps in the acceptance tests, which are CI's to run."
  fi
}

segments=$(printf '%s' "$command" | tr ';|&(){}' '\n\n\n\n\n\n\n')
scope=root
IFS='
'
for seg in $segments; do
  seg=$(printf '%s' "$seg" | sed -E "s/(^|$W)#.*$//")
  head=$(head_of "$seg")
  [ -z "$head" ] && continue

  if matches "$head" "^cd($W|$)"; then
    scope=$(cd_scope "$head")
    continue
  fi
  matches "$head" "$READ_ONLY" && continue

  if matches "$head" "$LINT_SCRIPT"; then
    refuse "a lint script runs over the whole repository, which is CI's to lint: read its verdict with lore_get_ci_failures. $LINT_HOW"
  fi
  if matches "$head" "$LINT"; then
    if downloads_linter "$head"; then
      refuse "npx would download this linter into the pod (#2155); run the checkout's own with npx --no-install eslint <files>. $LINT_HOW"
    fi
    lint_names_path "$head" \
      || refuse "the whole repository is CI's to lint: read its verdict with lore_get_ci_failures. $LINT_HOW"
    continue
  fi

  if [ "$policy" = "none" ]; then
    if matches "$seg" "$RUNNER" || matches "$seg" "$SCRIPT"; then
      refuse "this node does not run tests. CI runs the suite; review from the source tree and the diff alone."
    fi
    if { matches "$head" "$INSTALL" && ! matches "$head" "$LOCKFILE_INSTALL"; } || matches "$head" "$BUILD"; then
      refuse "this node does not build, and installs only the lockfile's dependencies (npm ci) a linter needs. CI already builds the branch."
    fi
    continue
  fi

  if matches "$seg" "$RUNNER" || matches "$seg" "$SCRIPT"; then
    acceptance_check "$seg"
    if [ "$scope" = "sub" ] || scoped_runner "$seg"; then
      continue
    fi
    refuse "the repository's full suite is not yours to run. CI runs it on every push. Name the test files or the directory you mean, e.g. \`npx vitest run path/to/thing.test.ts\`."
  fi
done

exit 0
