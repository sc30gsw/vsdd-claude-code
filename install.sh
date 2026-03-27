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

# VSDD Claude Code Plugin Installer
SCRIPT_DIR="$(resolve_script_path)"
PLUGIN_NAME="vsdd-claude-code"
VERSION="1.0.0"
COMMAND_NAME="$(basename "${0}")"

# Default profile
PROFILE="${VSDD_INSTALL_PROFILE:-standard}"
LANGUAGE="${VSDD_INSTALL_LANGUAGE:-}"
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

echo "VSDD Claude Code Plugin Installer v${VERSION}"
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

echo "Installing VSDD plugin to: ${PLUGIN_DIR}"
[[ "$DRY_RUN" == "false" ]] && mkdir -p "$PLUGIN_DIR"

# Copy plugin manifest
echo "  Installing plugin manifest..."
[[ "$DRY_RUN" == "false" ]] && cp -r "${SCRIPT_DIR}/.claude-plugin" "${PLUGIN_DIR}/"

# Install based on profile
case "$PROFILE" in
  minimal|standard|strict)
    echo "Installing profile: ${PROFILE}"
    install_module "rules" "$PLUGIN_DIR"
    install_module "commands" "$PLUGIN_DIR"
    if [[ "$PROFILE" == "minimal" ]]; then
      install_module "scripts/lib" "$PLUGIN_DIR"
    else
      install_module "agents" "$PLUGIN_DIR"
      install_module "skills" "$PLUGIN_DIR"
      install_module "contexts" "$PLUGIN_DIR"
      install_module "hooks" "$PLUGIN_DIR"
      install_module "scripts" "$PLUGIN_DIR"
    fi
    ;;
  *)
    echo "Error: Unknown profile '${PROFILE}'. Use: minimal, standard, strict"
    exit 1
    ;;
esac

# Install language profile if specified
if [[ -n "$LANGUAGE" ]]; then
  case "$LANGUAGE" in
    rust|python|typescript|go|cpp)
      echo "Installing language profile: ${LANGUAGE}"
      if [[ -d "${SCRIPT_DIR}/skills/vsdd-language-${LANGUAGE}" ]]; then
        install_module "skills/vsdd-language-${LANGUAGE}" "$PLUGIN_DIR"
      else
        echo "  Using manifest-backed language profile for: ${LANGUAGE}"
      fi
      install_module "manifests/language-profiles.json" "$PLUGIN_DIR"
      ;;
    *)
      echo "Warning: Unknown language '${LANGUAGE}'. Supported: rust, python, typescript, go, cpp"
      ;;
  esac
fi

# Copy schemas and manifests
install_module "schemas" "$PLUGIN_DIR"
install_module "manifests" "$PLUGIN_DIR"
install_module "CLAUDE.md" "$PLUGIN_DIR"
install_module "AGENTS.md" "$PLUGIN_DIR"

echo ""
echo "✅ VSDD Claude Code Plugin installed successfully!"
echo ""
echo "Getting started:"
echo "  1. Open a project in Claude Code"
echo "  2. Run: /vsdd-init <feature-name> --mode lean"
echo "  3. Run: /vsdd-spec"
echo "  4. Run: /vsdd-status"
echo ""
if [[ "$PROFILE" == "standard" || "$PROFILE" == "strict" ]]; then
  echo "Hooks: Default VSDD_HOOK_PROFILE=standard (gate enforcement on Write/Edit/Bash heuristics, session hooks, pre-compact)."
  echo ""
fi
if [[ "$PROFILE" == "strict" ]]; then
  echo "Strict hook profile: export VSDD_HOOK_PROFILE=strict (enables auto-commit hook path; still requires VSDD_AUTO_COMMIT=true to commit)."
  echo ""
fi
