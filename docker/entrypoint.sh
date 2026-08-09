#!/bin/sh
# Start opencode in single-page site mode against /workspace.
#
# Seeds an empty workspace from the template so a fresh container always has an
# index.html to render and an AGENTS.md to edit — a preview pane showing "Not
# Found" on first boot reads as a broken product.
set -eu

ROOT="${OPENCODE_PREVIEW_ROOT:-/workspace}"
PORT="${OPENCODE_PORT:-4096}"
HOSTNAME_="${OPENCODE_HOSTNAME:-0.0.0.0}"
CONFIG_DIR="${XDG_CONFIG_HOME:-/root/.config}/opencode"

mkdir -p "$ROOT"
[ -f "$ROOT/index.html" ] || cp /opt/site-template/index.html "$ROOT/index.html"
[ -f "$ROOT/AGENTS.md" ] || cp /opt/site-template/AGENTS.md "$ROOT/AGENTS.md"

# Baked defaults: the site editor may read and edit files, but not run shell
# commands. Mount your own config over this path to change that.
mkdir -p "$CONFIG_DIR"
[ -f "$CONFIG_DIR/opencode.json" ] || cp /opt/opencode-defaults.json "$CONFIG_DIR/opencode.json"

# Git identity, so the agent's commits (if the site is a repo) do not abort.
git config --global --get user.email >/dev/null 2>&1 || git config --global user.email "site@localhost"
git config --global --get user.name >/dev/null 2>&1 || git config --global user.name "Site editor"
git config --global --add safe.directory "$ROOT"

if [ -z "${OPENCODE_SERVER_PASSWORD:-}" ]; then
  echo "warning: OPENCODE_SERVER_PASSWORD is unset — anyone who can reach port $PORT can edit this site." >&2
fi

cd "$ROOT"

# Any extra args are passed through to opencode.
exec opencode serve --hostname "$HOSTNAME_" --port "$PORT" "$@"
