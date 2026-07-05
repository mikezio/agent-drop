# Deployment Notes

The recommended first setup is local-only:

```env
AGENT_DROP_HOST=127.0.0.1
AGENT_DROP_PORT=8400
NEXT_PUBLIC_BASE_PATH=
```

That serves the UI at `http://localhost:8400/`.

## LAN Access

To access the UI from another device on your network:

```env
AGENT_DROP_HOST=0.0.0.0
AGENT_DROP_PORT=8400
```

Restart:

```bash
docker compose up -d --build
```

Only do this on a trusted network. Add authentication before exposing sensitive drops to other people.

## Reverse Proxy At `/drop`

Set:

```env
NEXT_PUBLIC_BASE_PATH=/drop
```

Rebuild:

```bash
docker compose up -d --build
```

Example nginx location:

```nginx
location /drop/ {
    proxy_pass http://127.0.0.1:8400/drop/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Domain Access

If using a domain, put HTTPS and authentication at the reverse proxy. Agent Drop itself is intentionally simple and local-first; it does not provide user accounts.
