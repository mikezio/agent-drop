# Overview

Agent Drop has two parts:

- `secret-drop-ui/`: a local Next.js web UI for users.
- `mcp/`: a local stdio MCP server for terminal agents.

Both parts use the same `AGENT_DROP_DIR`:

```text
AGENT_DROP_DIR/
  user_drops/
  agent_drops/
```

The UI writes user uploads to `user_drops` and shows agent outputs from `agent_drops`. The MCP server lets CLI agents read unread user uploads and deliver files back to the user.

The default deployment is local-only. Domain names, reverse proxies, and subpaths such as `/drop` are optional advanced setup.
