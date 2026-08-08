#!/usr/bin/env bash
# Fail if any platform skill is missing its `## Help` block, or the block is
# malformed. /lore-help aggregates these blocks verbatim — a skill without one
# is invisible in the index, and a half-written one renders as a gap.
#
# Required shape (see .claude/skills/lore-help/SKILL.md):
#
#   <!-- lore-help:begin -->
#   **Summary.** One sentence.
#   **Usage:** `/skill-name [args]`
#   ...
#   <!-- lore-help:end -->
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

failed=0
checked=0

fail() {
	echo "ERROR: $1" >&2
	failed=1
}

for skill in .claude/skills/*/SKILL.md; do
	[ -f "$skill" ] || continue
	name="$(basename "$(dirname "$skill")")"
	checked=$((checked + 1))

	# Anchored: the markers also appear mid-sentence inside lore-help's own
	# instructions. Only a marker alone on its own line delimits a real block.
	begins="$(grep -c '^<!-- lore-help:begin -->$' "$skill" || true)"
	ends="$(grep -c '^<!-- lore-help:end -->$' "$skill" || true)"

	if [ "$begins" -eq 0 ]; then
		fail "$name has no '## Help' block — add one so /lore-help can document it."
		continue
	fi

	if [ "$begins" -ne 1 ] || [ "$ends" -ne 1 ]; then
		fail "$name has $begins begin / $ends end markers — expected exactly one of each."
		continue
	fi

	block="$(sed -n '/^<!-- lore-help:begin -->$/,/^<!-- lore-help:end -->$/p' "$skill")"

	grep -q '^\*\*Summary\.\*\*' <<<"$block" ||
		fail "$name's Help block has no '**Summary.**' line."
	grep -q '^\*\*Usage:\*\*' <<<"$block" ||
		fail "$name's Help block has no '**Usage:**' line."
done

if [ "$checked" -eq 0 ]; then
	fail "no skills found under .claude/skills/ — did the layout change?"
fi

if [ "$failed" -ne 0 ]; then
	echo >&2
	echo "Every .claude/skills/*/SKILL.md must end with a Help block that /lore-help reads." >&2
	echo "Copy the shape from .claude/skills/lore-help/SKILL.md." >&2
	exit 1
fi

echo "All $checked platform skills carry a well-formed Help block."
