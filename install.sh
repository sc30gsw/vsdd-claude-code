#!/usr/bin/env bash
set -euo pipefail

resolve_script_path() {
  local source="${BASH_SOURCE[0]}"
  while [[ -h "$source" ]]; do
    local dir
    dir="$(cd -P "$(dirname "$source")" && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="${dir}/${source}"
  done
  cd -P "$(dirname "$source")" && pwd
}

# VCSDD Claude Code Plugin Installer
SCRIPT_DIR="$(resolve_script_path)"
PLUGIN_NAME="vcsdd-claude-code"
VERSION="1.0.0"
COMMAND_NAME="$(basename "${0}")"

# Default profile
PROFILE="${VCSDD_INSTALL_PROFILE:-standard}"
LANGUAGE="${VCSDD_INSTALL_LANGUAGE:-}"
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)   PROFILE="$2"; shift 2 ;;
    --language)  LANGUAGE="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --help|-h)
      echo "Usage: ${COMMAND_NAME} [--profile minimal|standard|strict] [--language rust|python|typescript|go|cpp] [--dry-run]"
      exit 0
      ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

echo "VCSDD Claude Code Plugin Installer v${VERSION}"
echo "Profile: ${PROFILE}"
[[ -n "$LANGUAGE" ]] && echo "Language: ${LANGUAGE}"
[[ "$DRY_RUN" == "true" ]] && echo "[DRY RUN MODE - no files will be written]"
echo ""

# Detect Claude Code config directory
CLAUDE_CONFIG_DIR="${HOME}/.claude"
if [[ ! -d "$CLAUDE_CONFIG_DIR" ]]; then
  echo "Error: Claude Code config directory not found at ${CLAUDE_CONFIG_DIR}"
  echo "Please ensure Claude Code is installed: https://claude.ai/code"
  exit 1
fi

# Plugin destination
PLUGIN_DIR="${CLAUDE_CONFIG_DIR}/plugins/${PLUGIN_NAME}"

install_module() {
  local src="$1"
  local dest_base="$2"

  if [[ -d "${SCRIPT_DIR}/${src}" ]]; then
    local dest="${dest_base}/${src}"
    [[ "$DRY_RUN" == "false" ]] && mkdir -p "$dest"
    echo "  Installing directory: ${src} -> ${dest}"
    if [[ "$DRY_RUN" == "false" ]]; then
      cp -r "${SCRIPT_DIR}/${src}/." "${dest}/"
    fi
  elif [[ -f "${SCRIPT_DIR}/${src}" ]]; then
    local dest_dir="${dest_base}/$(dirname "${src}")"
    [[ "$DRY_RUN" == "false" ]] && mkdir -p "$dest_dir"
    echo "  Installing file: ${src}"
    if [[ "$DRY_RUN" == "false" ]]; then
      cp "${SCRIPT_DIR}/${src}" "${dest_dir}/"
    fi
  else
    echo "  Warning: ${src} not found, skipping"
  fi
}

echo "Installing VCSDD plugin to: ${PLUGIN_DIR}"
[[ "$DRY_RUN" == "false" ]] && mkdir -p "$PLUGIN_DIR"

# Copy plugin manifest
echo "  Installing plugin manifest..."
[[ "$DRY_RUN" == "false" ]] && cp -r "${SCRIPT_DIR}/.claude-plugin" "${PLUGIN_DIR}/"

echo "Installing profile: ${PROFILE}"

resolver_args=(
  "${SCRIPT_DIR}/scripts/install/resolve-install-plan.js"
  --profile "${PROFILE}"
  --format paths
)

if [[ -n "$LANGUAGE" ]]; then
  echo "Installing language profile: ${LANGUAGE}"
  resolver_args+=(--language "${LANGUAGE}")
fi

INSTALL_PATHS=()
while IFS= read -r install_path; do
  INSTALL_PATHS+=("$install_path")
done < <(node "${resolver_args[@]}")

for install_path in "${INSTALL_PATHS[@]}"; do
  [[ -n "$install_path" ]] || continue
  install_module "$install_path" "$PLUGIN_DIR"
done

echo ""
echo "✅ VCSDD Claude Code Plugin installed successfully!"
echo ""
echo "Getting started:"
echo "  1. Open a project in Claude Code"
echo "  2. Run: /vcsdd-init <feature-name> --mode lean"
echo "  3. Run: /vcsdd-spec"
echo "  4. Run: /vcsdd-status"
echo ""
if [[ "$PROFILE" == "standard" || "$PROFILE" == "strict" ]]; then
  echo "Hooks: Default VCSDD_HOOK_PROFILE=standard (gate enforcement on Write/Edit/Bash heuristics, session hooks, pre-compact)."
  echo ""
fi
if [[ "$PROFILE" == "strict" ]]; then
  echo "Strict hook profile: export VCSDD_HOOK_PROFILE=strict (enables auto-commit hook path; still requires VCSDD_AUTO_COMMIT=true to commit)."
  echo ""
fi
