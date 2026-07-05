# Contributing

Thanks for helping improve Agent Drop.

## Project Goals

- Keep local setup lightweight.
- Keep the MCP server and web UI pointed at one shared `AGENT_DROP_DIR`.
- Avoid requiring a domain, reverse proxy, cloud service, or hosted account.
- Treat dropped files as sensitive.

## Development

```bash
npm --prefix secret-drop-ui install
npm --prefix mcp install
AGENT_DROP_DIR=./data/agent-drop npm run dev
```

In another terminal, test the MCP server:

```bash
AGENT_DROP_DIR=./data/agent-drop npm run smoke:mcp
```

## Pull Requests

- Do not commit `.env`, `data/`, generated drop files, `node_modules`, or build output.
- Keep setup docs accurate for local terminal environments.
- Prefer small changes that make local use simpler.
- Put reverse-proxy or homelab-specific behavior in `docs/deployment.md`, not in the default config.
