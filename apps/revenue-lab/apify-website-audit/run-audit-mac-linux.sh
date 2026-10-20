#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ required: https://nodejs.org/" >&2; exit 1; }
echo "TigerIQ local audit: http://127.0.0.1:4179/ (Ctrl+C to stop)"
exec node website-ui.mjs
