# Agent Client Setup

Agent Drop is mainly for terminal agents. The web UI lets the human move files in and out; the MCP server lets the CLI agent see the same files.

## One Rule

Every client should use:

- the same MCP command
- the same `AGENT_DROP_DIR`

## Codex CLI

Add to Codex config:

```toml
[mcp_servers.agent-drop]
command = "/absolute/path/to/agent-drop/mcp/run.sh"
env = { AGENT_DROP_DIR = "/absolute/path/to/AgentDrop" }
```

## Gemini CLI / Other JSON MCP Clients

Use the JSON shape your client expects. The server entry usually looks like:

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

## Suggested Agent Instruction

```text
Use Agent Drop when the user uploads or asks for downloadable artifacts.
Call get_unread_uploads when the user says they uploaded, sent, or dropped a file.
Call deliver_to_user_device for generated files and reports.
Use generate_and_deliver_file only for short snippets.
```
