# Agent Drop MCP Usage

When this repo is configured as an MCP server in a CLI agent:

- Use `get_unread_uploads` when the user says they uploaded, sent, or dropped a file.
- Use `deliver_to_user_device` for generated files, reports, screenshots, exports, and other artifacts.
- Use `generate_and_deliver_file` only for short text snippets.
- Use `clear_drops` or `delete_specific_drop` only when the user wants cleanup.

This file is an example agent instruction. Users can adapt it for Gemini CLI, Codex CLI, Claude Code, or similar terminal agents.
