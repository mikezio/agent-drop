#!/usr/bin/env bash
set -euo pipefail

# Directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
APP_DIR="$DIR"

# Ensure Node and NPM are available
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed or not in PATH." >&2
    exit 1
fi

if [[ ! -d "$APP_DIR/node_modules" ]]; then
    echo "Error: MCP dependencies are not installed." >&2
    echo "Run: npm --prefix \"$APP_DIR\" install" >&2
    exit 1
fi

# Run the MCP Server
echo "Starting agent-drop-mcp server..." >&2
# Note: In Node.js MCPs, we use 'node' to execute the main script.
exec node "$APP_DIR/index.js"
