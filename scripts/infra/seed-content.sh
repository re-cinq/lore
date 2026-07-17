#!/usr/bin/env bash
set -euo pipefail

NS="lore-db"
POD="lore-db-1"
REPO="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"

echo "[lore] Re-seeding database from $REPO..."

# Truncate existing chunks
kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "TRUNCATE org_shared.chunks;"

# Insert all content files
insert() {
  local ctype="$1" fpath="$2"
  [ -f "$REPO/$fpath" ] || return
  local content
  content=$(cat "$REPO/$fpath" | sed "s/'/''/g")
  kubectl exec -n "$NS" "$POD" -- psql -U postgres -d lore -c "
    INSERT INTO org_shared.chunks (content, content_type, team, repo, file_path, metadata)
    VALUES ('${content}', '${ctype}', 'org_shared', 're-cinq/lore', '${fpath}', '{\"file_path\": \"${fpath}\"}');
  " >/dev/null 2>&1 && echo "  $fpath"
}

# Docs
for f in CLAUDE.md AGENTS.md CODEOWNERS .specify/memory/constitution.md; do insert doc "$f"; done

# Specs
for f in "$REPO"/specs/*/spec.md "$REPO"/specs/*/plan.md "$REPO"/specs/*/tasks.md "$REPO"/specs/*/research.md "$REPO"/specs/*/data-model.md; do
  [ -f "$f" ] && insert spec "$(echo "$f" | sed "s|$REPO/||")"
done

# Code (recurse into subdirs — after the apps/ regroup most source moved out of the
# top level into mcp/, platform/, features/, server/)
while IFS= read -r f; do insert code "${f#"$REPO"/}"; done < <(
  find "$REPO"/apps/mcp-server/src -type f -name '*.ts' ! -name '*.test.ts'
)

# Scripts
for f in "$REPO"/scripts/*.sh "$REPO"/scripts/*.js "$REPO"/scripts/*.py; do [ -f "$f" ] && insert code "scripts/$(basename "$f")"; done

# Lore Floor prompts
for f in "$REPO"/scripts/agent-prompts/*.md; do [ -f "$f" ] && insert doc "scripts/agent-prompts/$(basename "$f")"; done

# Skills
for f in "$REPO"/.claude/skills/*/SKILL.md; do [ -f "$f" ] && skill=$(basename "$(dirname "$f")") && insert doc ".claude/skills/$skill/SKILL.md"; done

echo "[lore] Done. Run scripts/infra/generate-embeddings.sh to add vector embeddings."
