# Security

Agent Drop stores whatever users and agents exchange. That can include API keys, passwords, screenshots, private documents, and generated files.

## Defaults

- The Docker Compose example binds the web UI to `127.0.0.1`.
- Dropped files are stored under `AGENT_DROP_DIR`.
- `.env` and `data/` are ignored by git.

## Recommendations

- Keep Agent Drop local unless you intentionally need remote access.
- Do not expose the UI to the internet without authentication and HTTPS from a reverse proxy.
- Use a dedicated `AGENT_DROP_DIR` outside any public git repo.
- Point every MCP client to the same `AGENT_DROP_DIR`.
- Clear old drops when you are done with a project.

## Reporting Issues

If you find a security issue, open a private advisory or contact the repository owner privately. Do not post secrets or exploit details in a public issue.
