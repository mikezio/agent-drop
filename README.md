# Agent Drop

[![CI](https://github.com/mikezio/agent-drop/actions/workflows/ci.yml/badge.svg)](https://github.com/mikezio/agent-drop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Local MCP file and secret handoff for CLI AI agents.**

Agent Drop gives you a small local web UI plus a local MCP server so you and your CLI coding agents can exchange files, API keys, passwords, screenshots, and generated artifacts without pasting sensitive data into the chat transcript.

Use it with terminal agents such as **Codex CLI**, **Gemini CLI**, **Claude Code**, and other MCP-capable CLI tools.

```text
You -> web UI -> user_drops/
Agent -> MCP -> agent_drops/
```

Your files stay on your machine.

## Why

CLI agents are powerful, but file handoff is still awkward:

- You need to give the agent a screenshot, PDF, token, key, or log file.
- You need to pass an API key or password without leaving it in the session history.
- The agent needs to give you a generated report, image, patch, export, or artifact.
- Terminal sessions usually do not have a clean upload/download lane.

Agent Drop is the missing local dropbox between you and the agent.

## Features

- Local web UI for uploading files and short notes to an agent.
- Secret-note flow for passwords, tokens, and API keys you do not want pasted into chat history.
- Download area for files delivered by agents.
- MCP server for CLI agents to read uploads and deliver artifacts.
- One shared local folder, configured with `AGENT_DROP_DIR`.
- One-time `.burn` notes for sensitive snippets.
- Docker Compose setup for the web UI.
- Guided setup for local terminal environments.
- Optional reverse proxy support for advanced self-hosting.

## Quick Start

Requirements:

- Node.js 20+
- npm
- Docker Engine with Docker Compose, or another Docker-compatible local runtime

Install:

```bash
git clone https://github.com/mikezio/agent-drop.git
cd agent-drop
npm run setup
docker compose up -d --build
```

Open:

```text
http://localhost:8400/
```

The setup script prints MCP config snippets for your CLI agent.

## Run Without Docker

```bash
npm --prefix secret-drop-ui install
npm --prefix mcp install
AGENT_DROP_DIR=./data/agent-drop npm run dev
```

Open `http://localhost:3000/`.

## How It Works

Agent Drop uses one local directory:

```text
AGENT_DROP_DIR/
  user_drops/     # files and notes uploaded by you
  agent_drops/    # files delivered by agents
```

The web UI and every MCP client must point to the same `AGENT_DROP_DIR`.

Good local defaults:

- Local terminal: `/home/you/AgentDrop`
- WSL/Linux VM: `/home/you/AgentDrop`
- Server: `/srv/agent-drop`

Do not put `AGENT_DROP_DIR` in a public repo. It may contain secrets.

## Configure Your CLI Agent

Agent Drop has one MCP server in `mcp/`.

MCP command:

```text
/absolute/path/to/agent-drop/mcp/run.sh
```

Codex CLI TOML:

```toml
[mcp_servers.agent-drop]
command = "/absolute/path/to/agent-drop/mcp/run.sh"
env = { AGENT_DROP_DIR = "/absolute/path/to/AgentDrop" }
```

Generic MCP JSON for Gemini CLI, Claude Code, and similar clients:

```json
{
  "mcpServers": {
    "agent-drop": {
      "command": "/absolute/path/to/agent-drop/mcp/run.sh",
      "env": {
        "AGENT_DROP_DIR": "/absolute/path/to/AgentDrop"
      }
    }
  }
}
```

More examples: [docs/agent-clients.md](docs/agent-clients.md)

## MCP Tools

- `get_unread_uploads`: returns unread user uploads and marks them as read.
- `list_all_uploads`: lists all user uploads.
- `deliver_to_user_device`: copies generated files into `agent_drops`.
- `generate_and_deliver_file`: creates a short text file in `agent_drops`.
- `delete_specific_drop`: deletes one file from either drop folder.
- `clear_drops`: clears user drops, agent drops, or both.

## Local First

Agent Drop is intentionally local-first:

- No account.
- No cloud service.
- No database.
- No hosted file storage.
- No domain required.

If you want LAN access, a domain, or `/drop` behind nginx/Caddy/Traefik, see [docs/deployment.md](docs/deployment.md).

## Security

Treat your drop directory as sensitive storage.

- Keep the UI bound to `127.0.0.1` unless you intentionally want network access.
- Add authentication before exposing the UI to a LAN or public domain.
- Secret notes avoid chat-history exposure; they are still local files until read or cleared.
- Never commit `.env`, `data/`, or dropped files.
- Clear old drops when a project is done.

See [SECURITY.md](SECURITY.md).

## Development

```bash
npm --prefix secret-drop-ui install
npm --prefix mcp install
AGENT_DROP_DIR=./data/agent-drop npm run dev
```

Build:

```bash
npm --prefix secret-drop-ui run build
```

Run the MCP server:

```bash
AGENT_DROP_DIR=./data/agent-drop npm --prefix mcp run start
```

## Project Layout

```text
secret-drop-ui/   Next.js web UI
mcp/              stdio MCP server
scripts/          guided setup and optional utilities
docs/             client and deployment notes
```

## License

MIT
