#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# lore-init.sh — Initialize Lore for a new organization
#
# Replaces the fictional Acme content with real content from your org.
# Creates team directories, skeleton CLAUDE.md files, CODEOWNERS, and
# optionally your first ADR.
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Fictional teams that ship with the template. These get removed unless
# the user picks them as real team names.
FICTIONAL_TEAMS=("payments" "platform" "mobile" "data")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()  { echo "[lore] $*"; }
warn()  { echo "[lore] Warning: $*"; }
die()   { echo "[lore] Error: $*" >&2; exit 1; }
blank() { echo ""; }

prompt() {
  local var="$1" msg="$2" default="${3:-}"
  if [ -n "$default" ]; then
    printf "%s [%s]: " "$msg" "$default"
  else
    printf "%s: " "$msg"
  fi
  read -r value
  value="${value:-$default}"
  eval "$var=\"\$value\""
}

confirm() {
  local msg="$1" default="${2:-N}"
  printf "%s " "$msg"
  read -r answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//'
}

# ---------------------------------------------------------------------------
# 1. Welcome
# ---------------------------------------------------------------------------

blank
info "Initializing Lore for your organization."
info "This will set up your team structure, first CLAUDE.md, and first ADR."
blank

# ---------------------------------------------------------------------------
# 2. Org name
# ---------------------------------------------------------------------------

prompt ORG_NAME "Organization name (GitHub org)"
[ -z "$ORG_NAME" ] && die "Organization name is required."

# ---------------------------------------------------------------------------
# 3. Team setup
# ---------------------------------------------------------------------------

TEAMS=()

blank
echo "How do you want to set up teams?"
echo "  1) Enter team names manually"
echo "  2) Import from GitHub organization teams"
blank
prompt TEAM_METHOD "Choose (1 or 2)" "1"

if [ "$TEAM_METHOD" = "2" ]; then
  # GitHub import
  if ! command -v gh &>/dev/null; then
    warn "'gh' CLI not found. Install from https://cli.github.com"
    warn "Falling back to manual entry."
    TEAM_METHOD="1"
  fi
fi

if [ "$TEAM_METHOD" = "2" ]; then
  info "Fetching teams from GitHub org '$ORG_NAME'..."
  GH_TEAMS=()
  while IFS= read -r slug; do
    [ -n "$slug" ] && GH_TEAMS+=("$slug")
  done < <(gh api "/orgs/$ORG_NAME/teams" --jq '.[].slug' 2>/dev/null || true)

  if [ "${#GH_TEAMS[@]}" -eq 0 ]; then
    warn "No teams found (check org name, authentication, and permissions)."
    warn "Falling back to manual entry."
    TEAM_METHOD="1"
  else
    blank
    info "Found ${#GH_TEAMS[@]} team(s):"
    for i in "${!GH_TEAMS[@]}"; do
      echo "  $((i+1))) ${GH_TEAMS[$i]}"
    done
    blank
    prompt TEAM_SELECTION "Select teams (comma-separated numbers, or 'all')" "all"

    if [ "$TEAM_SELECTION" = "all" ]; then
      TEAMS=("${GH_TEAMS[@]}")
    else
      IFS=',' read -ra INDICES <<< "$TEAM_SELECTION"
      for idx in "${INDICES[@]}"; do
        idx="$(echo "$idx" | tr -d ' ')"
        if [[ "$idx" =~ ^[0-9]+$ ]] && [ "$idx" -ge 1 ] && [ "$idx" -le "${#GH_TEAMS[@]}" ]; then
          TEAMS+=("${GH_TEAMS[$((idx-1))]}")
        else
          warn "Skipping invalid selection: $idx"
        fi
      done
    fi
  fi
fi

if [ "$TEAM_METHOD" = "1" ]; then
  blank
  prompt TEAM_INPUT "Team names (comma-separated, e.g. backend,frontend,infra)"
  [ -z "$TEAM_INPUT" ] && die "At least one team name is required."
  IFS=',' read -ra RAW_TEAMS <<< "$TEAM_INPUT"
  for t in "${RAW_TEAMS[@]}"; do
    t="$(echo "$t" | xargs)"  # trim whitespace
    [ -n "$t" ] && TEAMS+=("$(slugify "$t")")
  done
fi

if [ "${#TEAMS[@]}" -eq 0 ]; then
  die "No teams selected. Cannot continue."
fi

blank
info "Teams: ${TEAMS[*]}"

# ---------------------------------------------------------------------------
# 4. Create skeleton CLAUDE.md files
# ---------------------------------------------------------------------------

# Root CLAUDE.md
info "Creating root CLAUDE.md..."
cat > "$REPO_DIR/CLAUDE.md" << ROOTEOF
# ${ORG_NAME} Engineering Guide

## Architecture

<!-- Describe your service communication patterns here:
     - How do services talk to each other? (gRPC, REST, message queues?)
     - What's the API gateway?
     - Database ownership rules? -->

## Code Conventions

<!-- Describe your engineering standards:
     - Error handling patterns
     - Logging format and required fields
     - Auth patterns -->

## Key Services

<!-- List your main services:
     - service-name: what it owns, key constraints -->
ROOTEOF

# Team CLAUDE.md files
for team in "${TEAMS[@]}"; do
  team_dir="$REPO_DIR/teams/$team"
  mkdir -p "$team_dir"

  if [ -f "$team_dir/CLAUDE.md" ]; then
    # Check if the existing file is fictional content (from the template)
    is_fictional=false
    for ft in "${FICTIONAL_TEAMS[@]}"; do
      if [ "$team" = "$ft" ]; then
        is_fictional=true
        break
      fi
    done

    if $is_fictional; then
      info "Replacing fictional CLAUDE.md for team '$team'..."
    else
      info "Skipping teams/$team/CLAUDE.md (already exists)"
      continue
    fi
  else
    info "Creating teams/$team/CLAUDE.md..."
  fi

  cat > "$team_dir/CLAUDE.md" << TEAMEOF
# ${team} Team

<!-- This file describes conventions specific to the ${team} team.
     It's loaded automatically when a developer on this team opens Claude Code. -->

## Current Work

<!-- What is the team working on right now?
     Active migrations, feature work, tech debt efforts. -->

## Team Conventions

<!-- Patterns specific to this team that differ from or extend the org conventions. -->
TEAMEOF
done

# ---------------------------------------------------------------------------
# 5. Create CODEOWNERS
# ---------------------------------------------------------------------------

info "Creating CODEOWNERS..."
{
  echo "/CLAUDE.md @${ORG_NAME}/engineering"
  echo "/AGENTS.md @${ORG_NAME}/engineering"
  echo ""
  for team in "${TEAMS[@]}"; do
    echo "/teams/${team}/ @${ORG_NAME}/${team}"
  done
  echo ""
  echo "/adrs/ @${ORG_NAME}/engineering"
  echo "/runbooks/ @${ORG_NAME}/engineering"
  echo "/mcp-server/ @${ORG_NAME}/engineering"
  echo "/scripts/ @${ORG_NAME}/engineering"
  echo "/.github/ @${ORG_NAME}/engineering"
} > "$REPO_DIR/CODEOWNERS"

# ---------------------------------------------------------------------------
# 6. First ADR (optional)
# ---------------------------------------------------------------------------

ADR_CREATED=""

blank
if confirm "Want to document an existing architecture decision? (y/N)"; then
  prompt ADR_NUMBER "ADR number" "001"
  prompt ADR_TITLE "Title (one line)"

  if [ -z "$ADR_TITLE" ]; then
    warn "No title provided, skipping ADR creation."
  else
    ADR_SLUG="$(slugify "$ADR_TITLE")"
    ADR_FILE="$REPO_DIR/adrs/ADR-${ADR_NUMBER}-${ADR_SLUG}.md"

    if [ -f "$ADR_FILE" ]; then
      warn "$ADR_FILE already exists, skipping."
    else
      mkdir -p "$REPO_DIR/adrs"
      TODAY="$(date +%Y-%m-%d)"
      cat > "$ADR_FILE" << ADREOF
---
adr_number: ${ADR_NUMBER}
title: ${ADR_TITLE}
status: accepted
date: ${TODAY}
---

# ADR-${ADR_NUMBER}: ${ADR_TITLE}

## Context

<!-- What situation or problem led to this decision?
     Include the technical constraints, business requirements, and timeline
     pressures that were relevant at the time. -->

## Decision

<!-- What did you decide, and why this option over the alternatives?
     Be specific about the implementation approach. -->

## Consequences

<!-- What are the results of this decision?
     Include both positive outcomes and trade-offs. Be honest about
     what you gave up. -->

## Alternatives Considered

<!-- What other options did you evaluate?
     For each, briefly explain why it was rejected. -->
ADREOF
      ADR_CREATED="$ADR_FILE"
      info "Created $ADR_FILE"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 7. Update install.sh team list
# ---------------------------------------------------------------------------

info "Updating install.sh team list..."

# Build the new select_team function body
TEAM_MENU=""
TEAM_CASES=""
TEAM_COUNT="${#TEAMS[@]}"

for i in "${!TEAMS[@]}"; do
  n=$((i+1))
  TEAM_MENU="${TEAM_MENU}    echo \"  ${n}) ${TEAMS[$i]}\"\n"
  TEAM_CASES="${TEAM_CASES}      ${n}) TEAM=\"${TEAMS[$i]}\" ;;\n"
done

# Use a temp file + awk to replace the select_team function.
# This is more robust than sed for multi-line replacements.
INSTALL_SH="$REPO_DIR/scripts/install.sh"

if [ -f "$INSTALL_SH" ]; then
  awk -v menu="$TEAM_MENU" -v cases="$TEAM_CASES" -v count="$TEAM_COUNT" -v first="${TEAMS[0]}" '
  /^select_team\(\)/ {
    print "select_team() {"
    print "  CURRENT_STEP=\"detect/prompt for team\""
    print "  TEAM=\"$(git config --global lore.team 2>/dev/null || true)\""
    print ""
    print "  if [ -z \"$TEAM\" ]; then"
    print "    echo \"\""
    print "    echo \"[lore] Available teams:\""
    printf "%s", menu
    print "    echo \"\""
    printf "    read -r -p \"[lore] Select your team (1-%s): \" CHOICE\n", count
    print "    case \"$CHOICE\" in"
    printf "%s", cases
    printf "      *) echo \"[lore] Invalid choice, defaulting to '"'"'%s'"'"'\"; TEAM=\"%s\" ;;\n", first, first
    print "    esac"
    print "    git config --global lore.team \"$TEAM\""
    print "    echo \"[lore] Team set to '"'"'$TEAM'"'"' (stored in git config --global lore.team)\""
    print "  fi"
    print "}"
    # skip original function body
    in_func = 1
    brace_depth = 1
    next
  }
  in_func {
    # Count braces to find end of function
    n = split($0, chars, "")
    for (i = 1; i <= n; i++) {
      if (chars[i] == "{") brace_depth++
      if (chars[i] == "}") brace_depth--
    }
    if (brace_depth <= 0) {
      in_func = 0
    }
    next
  }
  { print }
  ' "$INSTALL_SH" > "$INSTALL_SH.tmp" && mv "$INSTALL_SH.tmp" "$INSTALL_SH"
  chmod +x "$INSTALL_SH"
  info "Updated install.sh with teams: ${TEAMS[*]}"
else
  warn "install.sh not found, skipping."
fi

# ---------------------------------------------------------------------------
# 8. Update package.json org name
# ---------------------------------------------------------------------------

PKG_JSON="$REPO_DIR/mcp-server/package.json"
if [ -f "$PKG_JSON" ]; then
  # Replace the package scope. Works with both sed on macOS and Linux.
  if sed --version 2>/dev/null | grep -q GNU; then
    sed -i "s|@re-cinq/lore-mcp|@${ORG_NAME}/lore-mcp|g" "$PKG_JSON"
  else
    sed -i '' "s|@re-cinq/lore-mcp|@${ORG_NAME}/lore-mcp|g" "$PKG_JSON"
  fi
  info "Updated package.json: @${ORG_NAME}/lore-mcp"
else
  warn "mcp-server/package.json not found, skipping."
fi

# ---------------------------------------------------------------------------
# 9. Clean up fictional content
# ---------------------------------------------------------------------------

info "Cleaning up fictional content..."

# Remove fictional team directories that weren't selected as real teams
for ft in "${FICTIONAL_TEAMS[@]}"; do
  is_selected=false
  for team in "${TEAMS[@]}"; do
    if [ "$team" = "$ft" ]; then
      is_selected=true
      break
    fi
  done
  if ! $is_selected; then
    if [ -d "$REPO_DIR/teams/$ft" ]; then
      rm -rf "$REPO_DIR/teams/$ft"
      info "  Removed fictional team: teams/$ft/"
    fi
  fi
done

# Remove fictional ADRs
for adr in "$REPO_DIR"/adrs/ADR-042-*.md "$REPO_DIR"/adrs/ADR-071-*.md "$REPO_DIR"/adrs/ADR-089-*.md; do
  if [ -f "$adr" ]; then
    rm "$adr"
    info "  Removed fictional ADR: $(basename "$adr")"
  fi
done

# Remove fictional runbooks
for rb in "$REPO_DIR"/runbooks/*.md; do
  if [ -f "$rb" ]; then
    rm "$rb"
    info "  Removed fictional runbook: $(basename "$rb")"
  fi
done

# ---------------------------------------------------------------------------
# 10. Summary
# ---------------------------------------------------------------------------

TEAM_LIST="$(IFS=', '; echo "${TEAMS[*]}")"
ADR_STATUS="none yet"
[ -n "$ADR_CREATED" ] && ADR_STATUS="1 created"

blank
info "Initialization complete."
echo "  Organization: ${ORG_NAME}"
echo "  Teams: ${TEAM_LIST}"
echo "  CLAUDE.md: created (fill in your conventions)"
echo "  CODEOWNERS: created"
echo "  ADRs: ${ADR_STATUS}"
blank
echo "Next steps:"
echo "  1. Fill in CLAUDE.md with your actual architecture and conventions"
echo "  2. Fill in teams/*/CLAUDE.md with team-specific patterns"
echo "  3. Write your first ADR if you haven't already"
echo "  4. Run: git add -A && git commit -m \"initialize lore for ${ORG_NAME}\""
echo "  5. Run install.sh to set up Claude Code"
blank
